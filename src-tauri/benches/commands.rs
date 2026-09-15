//! What the IPC surface costs, by class of command.
//!
//! ⚠️ Below the command boundary, not through Tauri: a command is four lines, so
//! `store::*` plus `view::*` plus the serde round trip captures nearly all of the cost.
//! `tauri::test::mock_app` would drag the whole app lifecycle in and buy only the IPC
//! transport, which this codebase does not control.
//!
//! ```
//! cargo bench -- --save-baseline main
//! cargo bench -- --baseline main
//! ```

mod corpus;

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};

use devbox_lib::attachments::store as attachments;
use devbox_lib::notes::model::NotePatch;
use devbox_lib::notes::store;
use devbox_lib::notes::view::{self, NoteFilter, NotesQuery};
use devbox_lib::transfer::{bundle, file};

use corpus::{Corpus, NOTES, build, now};

fn query(search: &str) -> NotesQuery {
    NotesQuery {
        space_id: None,
        search: search.to_string(),
        filter: NoteFilter::All,
        tags: Vec::new(),
        languages: Vec::new(),
        now: now(),
        tz_offset_minutes: -120,
        pinned_first: true,
    }
}

/// Everything `query_notes` does, in its order, serialisation included.
fn run_query(corpus: &mut Corpus, request: &NotesQuery) -> String {
    let (notes, facets) = store::fetch(&mut corpus.connection, request).expect("a view");
    let counts = attachments::counts(&mut corpus.connection).expect("the counters");
    let globals = store::global_placeholder_values(&mut corpus.connection).expect("the globals");

    let mut built = view::build(notes, facets, request);
    view::apply_attachment_counts(&mut built, &counts);
    view::apply_global_defaults(&mut built, &globals);

    serde_json::to_string(&built).expect("a serialisable view")
}

/// The one that matters most: it runs on every keystroke, behind the 150 ms debounce.
fn whole_corpus_read(c: &mut Criterion) {
    let mut corpus = build();
    let mut group = c.benchmark_group("whole-corpus read");
    // A pass over 8000 notes is long enough that criterion's hundred samples would make
    // this group most of the run.
    group.sample_size(20);

    group.bench_function("query_notes, unfiltered", |b| {
        b.iter(|| black_box(run_query(&mut corpus, &query(""))));
    });

    // Matching runs on the fetched rows, not in SQL — the needle decides the cost.
    group.bench_function("query_notes, search matching nothing", |b| {
        b.iter(|| black_box(run_query(&mut corpus, &query("zzz-no-such-needle"))));
    });

    // ⚠️ Unaccented on purpose: the fold has to strip the accents off every byte of the
    // corpus before it can answer.
    group.bench_function("query_notes, search folding accents", |b| {
        b.iter(|| black_box(run_query(&mut corpus, &query("deploiement"))));
    });

    group.finish();
}

/// The editor's round trip, once per field committed.
fn single_write(c: &mut Criterion) {
    let mut corpus = build();
    let mut group = c.benchmark_group("single write");

    group.bench_function("update_note", |b| {
        let id = corpus.note_ids[NOTES / 2].clone();
        let mut at = 0u32;
        b.iter(|| {
            at += 1;
            let patch = NotePatch {
                title: Some(format!("Retitled {at}")),
                ..NotePatch::default()
            };
            black_box(store::update(&mut corpus.connection, &id, &patch, now()).expect("a write"));
        });
    });

    group.finish();
}

/// One lock, N rows. The selection bar's actions.
fn bulk(c: &mut Criterion) {
    let mut corpus = build();
    let mut group = c.benchmark_group("bulk over 100 notes");
    let ids: Vec<String> = corpus.note_ids.iter().take(100).cloned().collect();

    group.bench_function("tag_notes", |b| {
        b.iter(|| {
            black_box(
                store::tag_many(&mut corpus.connection, &ids, &["bulk".to_string()], now())
                    .expect("a batch"),
            );
        });
    });

    group.bench_function("move_notes", |b| {
        let mut at = 0usize;
        b.iter(|| {
            at += 1;
            let target = &corpus.space_ids[at % corpus.space_ids.len()];
            black_box(
                store::move_many(&mut corpus.connection, &ids, target, now()).expect("a batch"),
            );
        });
    });

    group.bench_function("delete_notes then restore_notes", |b| {
        b.iter(|| {
            store::trash::trash_many(&mut corpus.connection, &ids, now()).expect("a trashing");
            black_box(
                store::trash::restore_many(&mut corpus.connection, &ids).expect("a restoration"),
            );
        });
    });

    group.finish();
}

/// The facet and panel queries, each one a pass over a side table.
fn aggregation(c: &mut Criterion) {
    let mut corpus = build();
    let mut group = c.benchmark_group("corpus-wide aggregation");

    group.bench_function("list_tags", |b| {
        b.iter(|| black_box(store::tag_usage(&mut corpus.connection).expect("the tags")));
    });

    group.bench_function("list_trash, nothing trashed", |b| {
        b.iter(|| {
            black_box(store::trash::list_trashed(&mut corpus.connection).expect("the trash"));
        });
    });

    group.bench_function("list_global_placeholders", |b| {
        b.iter(|| {
            black_box(
                store::global_placeholder_values(&mut corpus.connection).expect("the globals"),
            );
        });
    });

    group.finish();
}

/// `retag` touches every matching row, in one transaction.
fn corpus_rewrite(c: &mut Criterion) {
    let mut corpus = build();
    let mut group = c.benchmark_group("corpus-wide rewrite");

    group.bench_function("rename_tag", |b| {
        let mut at = 0u32;
        b.iter(|| {
            at += 1;
            let (from, into) = if at.is_multiple_of(2) {
                ("ops", "operations")
            } else {
                ("operations", "ops")
            };
            black_box(
                store::retag(&mut corpus.connection, &[from.to_string()], into).expect("a retag"),
            );
        });
    });

    group.finish();
}

/// The bundle both ways, against a real file.
fn disk(c: &mut Criterion) {
    let mut corpus = build();
    let mut group = c.benchmark_group("disk");
    // The bundle is ~100 MB, so these two want their own sample size.
    group.sample_size(10);

    let path = std::env::temp_dir().join("devbox-bench-export.devbox");
    let target = path.to_string_lossy().to_string();
    // The corpus seeds no attachment, so the archive carries the bundle alone. What the
    // directory is does not matter; that it exists does.
    let attachments = std::env::temp_dir();

    group.bench_function("export_notes", |b| {
        b.iter(|| {
            let notes = store::all(&mut corpus.connection, None).expect("the corpus");
            let packed = bundle::collect(&mut corpus.connection, notes).expect("a bundle");
            black_box(file::write(&target, &packed, &attachments).expect("a written file"));
        });
    });

    group.bench_function("import_notes, every id already there", |b| {
        b.iter(|| {
            let (incoming, mut payload) = file::read(&target).expect("a readable file");
            black_box(
                bundle::merge(&mut corpus.connection, incoming, &mut payload, &attachments)
                    .expect("a merge"),
            );
        });
    });

    group.finish();
    let _ = std::fs::remove_file(&path);
}

criterion_group!(
    benches,
    whole_corpus_read,
    single_write,
    bulk,
    aggregation,
    corpus_rewrite,
    disk
);
criterion_main!(benches);
