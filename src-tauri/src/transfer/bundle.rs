//! The commands in `transfer.rs` open the file and hold the lock; the rules live here.

use std::collections::BTreeMap;

use chrono::Utc;
use diesel::SqliteConnection;
use diesel::prelude::*;

use super::model::{self, Bundle, ImportReport, IncomingBundle};
use crate::error::StorageError;
use crate::notes::model::Note;
use crate::notes::store as notes;
use crate::spaces::model::Space;
use crate::spaces::store as spaces;

/// Only the spaces actually cited travel with the notes: exporting one space must not
/// recreate the whole tree for whoever imports it.
pub fn collect(
    connection: &mut SqliteConnection,
    exported: Vec<Note>,
) -> Result<Bundle, StorageError> {
    let spaces: Vec<Space> = spaces::list(connection)?
        .into_iter()
        .filter(|space| exported.iter().any(|note| note.space_id == space.id))
        .collect();

    Ok(Bundle {
        version: model::FORMAT_VERSION,
        exported_at: Utc::now(),
        spaces,
        notes: exported,
    })
}

/// Merge, never replace: spaces are matched by name, and a note whose id is already taken
/// is counted then set aside, so importing the same file twice duplicates nothing.
///
/// ⚠️ One transaction for the whole file, or a failure halfway leaves spaces created and
/// part of the notes in, with the report lost along with the error.
pub fn merge(
    connection: &mut SqliteConnection,
    incoming: IncomingBundle,
) -> Result<ImportReport, StorageError> {
    let IncomingBundle { bundle, degraded } = incoming;

    connection.transaction(|connection| {
        let mut report = ImportReport::default();

        let mut mapping: BTreeMap<String, String> = BTreeMap::new();
        let existing = spaces::list(connection)?;

        for space in &bundle.spaces {
            let matched = existing
                .iter()
                .find(|candidate| candidate.name.to_lowercase() == space.name.to_lowercase());

            let local_id = if let Some(candidate) = matched {
                candidate.id.clone()
            } else {
                report.spaces_created += 1;
                spaces::create(connection, &space.name)?.id
            };
            mapping.insert(space.id.clone(), local_id);
        }

        for mut note in bundle.notes {
            let Some(space_id) = mapping.get(&note.space_id) else {
                // A file truncated by hand: inventing a space would file the note where
                // nobody will look.
                report.notes_skipped += 1;
                continue;
            };
            note.space_id.clone_from(space_id);

            if notes::insert_imported(connection, &note)? {
                report.notes_imported += 1;
                // Only what actually came in, or re-importing the same file would keep
                // reporting the same degradation.
                if degraded.contains(&note.id) {
                    report.notes_degraded += 1;
                }
            } else {
                report.notes_skipped += 1;
            }
        }

        Ok(report)
    })
}

/// The space names an export needs to render a note's breadcrumb.
pub fn space_names(
    connection: &mut SqliteConnection,
) -> Result<BTreeMap<String, String>, StorageError> {
    Ok(spaces::list(connection)?
        .into_iter()
        .map(|space| (space.id, space.name))
        .collect())
}
