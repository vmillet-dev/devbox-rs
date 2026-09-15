//! The corpus the benchmarks run against.
//!
//! **8000 notes of ~13 kB**, the shape quoted in `notes/view.rs` taken to the size #21 is
//! about — a corpus big enough that a linear cost shows up as one.
//!
//! ⚠️ **File-backed, never `open_in_memory`.** An in-memory database has no pager behind a
//! file, no page cache and no I/O, so it measures something the application never does.

use std::path::PathBuf;

use chrono::{DateTime, TimeDelta, Utc};
use devbox_lib::db::Library;

use devbox_lib::db;
use devbox_lib::notes::checklist::{ChecklistItem, NoteKind};
use devbox_lib::notes::language::Language;
use devbox_lib::notes::model::{NoteDraft, NoteLifecycle};
use devbox_lib::notes::store;
use devbox_lib::spaces::store as spaces;

pub(crate) const NOTES: usize = 8000;
/// Roughly 13 kB of body.
const LINES_PER_NOTE: usize = 200;
const SPACES: usize = 4;
const TAGS: &[&str] = &[
    "angular", "api", "ci", "db", "docker", "git", "ops", "rust", "sql", "ssh",
];

/// A database file of its own per group, erased with the guard.
pub(crate) struct Corpus {
    pub(crate) connection: Library,
    pub(crate) space_ids: Vec<String>,
    pub(crate) note_ids: Vec<String>,
    /// ⚠️ Last, and the erasure lives on this field rather than on `Corpus`: fields drop
    /// in declaration order, but a `Drop` on the struct runs *before* all of them — with
    /// the connection still open, which Windows refuses to delete over.
    _directory: TempDir,
}

struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        // The WAL and the shm sit beside it; the whole directory goes.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn now() -> DateTime<Utc> {
    db::iso8601::parse("2026-07-25T09:00:00.000Z").expect("a valid instant")
}

/// ⚠️ Accented on purpose: `fold` has a fast path for pure ASCII, and a corpus that only
/// took it would measure the one branch that was never in question.
fn body(seed: usize) -> String {
    let mut text = String::with_capacity(LINES_PER_NOTE * 70);
    for line in 0..LINES_PER_NOTE {
        text.push_str(match (seed + line) % 4 {
            0 => "    let étape = migration::run(&mut connection)?; // déploiement\n",
            1 => "    kubectl rollout restart deployment/api --namespace prod\n",
            2 => "    SELECT calls, mean_exec_time FROM pg_stat_statements LIMIT 20;\n",
            _ => "    const keysOf = <T extends object>(value: T) => Object.keys(value);\n",
        });
    }
    text
}

fn draft(seed: usize, space_id: &str) -> NoteDraft {
    let checklist = seed.is_multiple_of(10);

    NoteDraft {
        space_id: space_id.to_string(),
        title: format!("Note {seed} — étape de déploiement"),
        language: Language::Rs,
        content: if checklist { String::new() } else { body(seed) },
        source: "Runbook".to_string(),
        tags: vec![
            TAGS[seed % TAGS.len()].to_string(),
            TAGS[(seed + 3) % TAGS.len()].to_string(),
        ],
        pinned: seed.is_multiple_of(50),
        lifecycle: if seed.is_multiple_of(25) {
            NoteLifecycle::Expires {
                at: now() + TimeDelta::days(3),
            }
        } else {
            NoteLifecycle::Permanent
        },
        kind: if checklist {
            NoteKind::Checklist
        } else {
            NoteKind::Snippet
        },
        items: if checklist {
            (0..5u32)
                .map(|at| ChecklistItem {
                    text: format!("Étape {at} du déploiement"),
                    done: at.is_multiple_of(2),
                })
                .collect()
        } else {
            Vec::new()
        },
    }
}

/// Seeded once per benchmark group, never inside a `b.iter`.
pub(crate) fn build() -> Corpus {
    let directory = std::env::temp_dir().join(format!("devbox-bench-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).expect("a writable temporary directory");

    // The corpus is sealed like a real library, so the benchmarks measure what the
    // commands really pay, encryption included.
    let mut connection = db::open(
        &directory.join("bench.sqlite3"),
        db::bench_vault().expect("a key"),
    )
    .expect("a fresh database");

    let space_ids: Vec<String> = (0..SPACES)
        .map(|at| {
            spaces::create(&mut connection, &format!("Space {at}"))
                .expect("a space")
                .id
        })
        .collect();

    let at = now();
    let note_ids: Vec<String> = (0..NOTES)
        .map(|seed| {
            let space_id = &space_ids[seed % SPACES];
            store::create(&mut connection, draft(seed, space_id), at)
                .expect("a note")
                .id
        })
        .collect();

    Corpus {
        connection,
        space_ids,
        note_ids,
        _directory: TempDir(directory),
    }
}
