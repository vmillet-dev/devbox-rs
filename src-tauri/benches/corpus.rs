//! The corpus the benchmarks run against, and the shape of it is a decision.
//!
//! **800 notes of ~13 kB.** Not a round number picked for looks: it is the shape already
//! quoted in `notes/view.rs`, where the accent fold is measured at 6.3 ms and the
//! streaming NFD version at 76 ms. Numbers produced here are comparable to those, and
//! #30 needs the same fixture to defend them — whichever of the two lands first builds
//! it, and this is it.
//!
//! ⚠️ **File-backed, never `open_in_memory`.** The 295 tests use the in-memory database
//! and it would be natural to reuse it here. An in-memory database has no pager backed by
//! a file, no page cache doing real work and no I/O at all, so it measures something the
//! application never does. The numbers would be pleasant and useless.

use std::path::PathBuf;

use chrono::{DateTime, TimeDelta, Utc};
use diesel::SqliteConnection;

use devbox_lib::db;
use devbox_lib::notes::checklist::{ChecklistItem, NoteKind};
use devbox_lib::notes::language::Language;
use devbox_lib::notes::model::{NoteDraft, NoteLifecycle};
use devbox_lib::notes::store;
use devbox_lib::spaces::store as spaces;

pub(crate) const NOTES: usize = 800;
/// Roughly 13 kB of body, the size the quoted measurements were taken at.
const LINES_PER_NOTE: usize = 200;
const SPACES: usize = 4;
const TAGS: &[&str] = &[
    "angular", "api", "ci", "db", "docker", "git", "ops", "rust", "sql", "ssh",
];

/// A database file of its own per run, dropped with the guard.
pub(crate) struct Corpus {
    pub(crate) connection: SqliteConnection,
    pub(crate) space_ids: Vec<String>,
    pub(crate) note_ids: Vec<String>,
    directory: PathBuf,
}

impl Drop for Corpus {
    fn drop(&mut self) {
        // The WAL and the shm sit beside it; the whole directory goes.
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

pub(crate) fn now() -> DateTime<Utc> {
    db::iso8601::parse("2026-07-25T09:00:00.000Z").expect("a valid instant")
}

/// ⚠️ Accented on purpose, and not decoration: search folds every byte it reads, and a
/// pure-ASCII corpus would measure the fast path only — which is the one branch of `fold`
/// that was never in question.
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

/// Seeded once per benchmark group. Writing 800 notes takes a few seconds, which is why
/// it is never inside a `b.iter`.
pub(crate) fn build() -> Corpus {
    let directory = std::env::temp_dir().join(format!("devbox-bench-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).expect("a writable temporary directory");

    let mut connection = db::open(&directory.join("bench.sqlite3")).expect("a fresh database");

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
        directory,
    }
}
