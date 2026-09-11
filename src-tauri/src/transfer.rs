// Commands receive their arguments owned, deserialised from the IPC payload.
#![allow(clippy::needless_pass_by_value)]

pub mod model;

use std::collections::BTreeMap;

use chrono::Utc;
use diesel::SqliteConnection;
use tauri::State;

use crate::count::saturating_u32;
use crate::db::{Db, lock};
use crate::error::{AppError, StorageError};
use crate::notes::model::Note;
use crate::notes::store as notes;
use crate::spaces::model::Space;
use crate::spaces::store as spaces;
use model::{Bundle, ExportReport, ImportReport};

fn space_names(
    connection: &mut SqliteConnection,
) -> Result<BTreeMap<String, String>, StorageError> {
    Ok(spaces::list(connection)?
        .into_iter()
        .map(|space| (space.id, space.name))
        .collect())
}

/// Only the spaces **actually cited** travel with the notes: exporting one space
/// must not recreate the whole tree for whoever imports it.
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

/// **Merge, never replace**: spaces are matched by name (case-insensitively), and a
/// note whose id is already taken is counted then set aside. Importing the same file
/// twice therefore duplicates nothing, which the report says.
pub fn merge(
    connection: &mut SqliteConnection,
    bundle: Bundle,
) -> Result<ImportReport, StorageError> {
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
        } else {
            report.notes_skipped += 1;
        }
    }

    Ok(report)
}

fn write(path: &str, bundle: &Bundle) -> Result<ExportReport, AppError> {
    let report = ExportReport {
        notes: saturating_u32(bundle.notes.len()),
        spaces: saturating_u32(bundle.spaces.len()),
    };

    let json = serde_json::to_string_pretty(bundle)
        .map_err(|error| StorageError::File(error.to_string()))?;
    std::fs::write(path, json).map_err(|error| StorageError::File(format!("{path}: {error}")))?;

    Ok(report)
}

/// The spaces travel with the notes: without them an import would hold an id with
/// nowhere to file it.
#[tauri::command]
#[specta::specta]
pub fn export_notes(
    path: String,
    space_id: Option<String>,
    db: State<'_, Db>,
) -> Result<ExportReport, AppError> {
    model::validate_path(&path)?;

    let bundle = {
        let mut connection = lock(&db)?;
        let exported = notes::all(&mut connection, space_id.as_deref())?;
        collect(&mut connection, exported)?
    };

    write(&path, &bundle)
}

#[tauri::command]
#[specta::specta]
pub fn export_selection(
    path: String,
    ids: Vec<String>,
    db: State<'_, Db>,
) -> Result<ExportReport, AppError> {
    model::validate_path(&path)?;

    let bundle = {
        let mut connection = lock(&db)?;
        let exported = notes::by_ids(&mut connection, &ids)?;
        collect(&mut connection, exported)?
    };

    write(&path, &bundle)
}

#[tauri::command]
#[specta::specta]
pub fn import_notes(path: String, db: State<'_, Db>) -> Result<ImportReport, AppError> {
    model::validate_path(&path)?;

    let json = std::fs::read_to_string(&path)
        .map_err(|error| StorageError::File(format!("{path}: {error}")))?;
    let bundle = model::read_bundle(&json)?;

    let mut connection = lock(&db)?;

    Ok(merge(&mut connection, bundle)?)
}

/// Nothing is sent anywhere: "share" stops at the clipboard.
#[tauri::command]
#[specta::specta]
pub fn share_notes(ids: Vec<String>, db: State<'_, Db>) -> Result<String, AppError> {
    let mut connection = lock(&db)?;
    let selected = notes::by_ids(&mut connection, &ids)?;
    let names = space_names(&mut connection)?;

    Ok(model::to_markdown(&selected, &names))
}
