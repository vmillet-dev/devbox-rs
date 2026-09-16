//! The commands in `transfer.rs` open the file and hold the lock; the rules live here.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::Utc;
use diesel::SqliteConnection;

use super::file::Payload;
use super::model::{self, Bundle, ImportReport, IncomingBundle};
use crate::attachments::model::Attachment;
use crate::attachments::store as attachments;
use crate::db::Library;
use crate::error::StorageError;
use crate::notes::model::Note;
use crate::notes::store as notes;
use crate::spaces::model::Space;
use crate::spaces::store as spaces;
use crate::vault::key::Vault;

/// Only the spaces actually cited travel with the notes: exporting one space must not
/// recreate the whole tree for whoever imports it.
pub fn collect(connection: &mut Library, exported: Vec<Note>) -> Result<Bundle, StorageError> {
    let spaces: Vec<Space> = spaces::list(connection)?
        .into_iter()
        .filter(|space| exported.iter().any(|note| note.space_id == space.id))
        .collect();

    let note_ids: Vec<String> = exported.iter().map(|note| note.id.clone()).collect();

    Ok(Bundle {
        version: model::FORMAT_VERSION,
        exported_at: Utc::now(),
        spaces,
        attachments: attachments::for_notes(connection, &note_ids)?,
        notes: exported,
    })
}

/// Merge, never replace: spaces are matched by name, and a note whose id is already taken
/// is counted then set aside, so importing the same file twice duplicates nothing.
///
/// ⚠️ One transaction for the whole file, or a failure halfway leaves spaces created and
/// part of the notes in, with the report lost along with the error.
pub fn merge(
    connection: &mut Library,
    incoming: IncomingBundle,
    payload: &mut Payload,
    directory: &Path,
) -> Result<ImportReport, StorageError> {
    let IncomingBundle { bundle, degraded } = incoming;

    connection.transaction(|connection, vault| {
        let mut report = ImportReport::default();

        let mut arrived: BTreeSet<String> = BTreeSet::new();
        let mut mapping: BTreeMap<String, String> = BTreeMap::new();
        let existing = spaces::list_in(connection, vault)?;

        for space in &bundle.spaces {
            let matched = existing
                .iter()
                .find(|candidate| candidate.name.to_lowercase() == space.name.to_lowercase());

            let local_id = if let Some(candidate) = matched {
                candidate.id.clone()
            } else {
                report.spaces_created += 1;
                spaces::create_in(connection, vault, &space.name)?.id
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

            if notes::insert_imported_in(connection, vault, &note)? {
                report.notes_imported += 1;
                arrived.insert(note.id.clone());
                // Only what actually came in, or re-importing the same file would keep
                // reporting the same degradation.
                if degraded.contains(&note.id) {
                    report.notes_degraded += 1;
                }
            } else {
                report.notes_skipped += 1;
            }
        }

        restore_attachments(
            connection,
            vault,
            bundle.attachments,
            &arrived,
            payload,
            directory,
            &mut report,
        )?;

        Ok(report)
    })
}

/// ⚠️ The file is written **before** the record, the rule `attachments.rs` already holds:
/// a record without a file is a broken thumbnail, where a file without a record is swept
/// at the next startup — which is also what collects these when the transaction rolls back.
///
/// Only attachments whose note actually arrived: one belonging to a skipped note is
/// already in the library, and re-importing the same file has to add nothing.
fn restore_attachments(
    connection: &mut SqliteConnection,
    vault: &Vault,
    records: Vec<Attachment>,
    arrived: &BTreeSet<String>,
    payload: &mut Payload,
    directory: &Path,
    report: &mut ImportReport,
) -> Result<(), StorageError> {
    for record in records {
        if !arrived.contains(&record.note_id) {
            continue;
        }

        let Some(bytes) = payload.take(&record.stored_name()) else {
            report.attachments_missing += 1;
            continue;
        };

        std::fs::write(directory.join(record.stored_name()), &bytes)
            .map_err(|error| StorageError::File(format!("{}: {error}", record.stored_name())))?;
        attachments::create(connection, vault, &record)?;
        report.attachments_imported += 1;
    }

    Ok(())
}

/// The space names an export needs to render a note's breadcrumb.
pub fn space_names(connection: &mut Library) -> Result<BTreeMap<String, String>, StorageError> {
    Ok(spaces::list(connection)?
        .into_iter()
        .map(|space| (space.id, space.name))
        .collect())
}
