// Commands receive their arguments owned, deserialised from the IPC payload.
#![allow(clippy::needless_pass_by_value)]

pub mod model;

use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use chrono::Utc;
use diesel::SqliteConnection;
use diesel::prelude::*;
use tauri::State;
use uuid::Uuid;

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
///
/// ⚠️ One transaction for the whole file: a failure halfway used to leave spaces
/// created and part of the notes in, with the report lost along with the error.
pub fn merge(
    connection: &mut SqliteConnection,
    bundle: Bundle,
) -> Result<ImportReport, StorageError> {
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
            } else {
                report.notes_skipped += 1;
            }
        }

        Ok(report)
    })
}

/// ⚠️ Written beside the target then renamed: `fs::write` truncates first, so an
/// export that ran out of disk destroyed the file it was overwriting.
fn write(path: &str, bundle: &Bundle) -> Result<ExportReport, AppError> {
    let report = ExportReport {
        notes: saturating_u32(bundle.notes.len()),
        spaces: saturating_u32(bundle.spaces.len()),
    };

    let json = serde_json::to_string_pretty(bundle)
        .map_err(|error| StorageError::File(error.to_string()))?;

    let staged = staging_path(path);
    std::fs::write(&staged, json)
        .map_err(|error| StorageError::File(format!("{}: {error}", staged.display())))?;

    if let Err(error) = std::fs::rename(&staged, path) {
        let _ = std::fs::remove_file(&staged);
        return Err(StorageError::File(format!("{path}: {error}")).into());
    }

    Ok(report)
}

/// Same directory as the target, or the rename would cross volumes and stop being
/// atomic.
fn staging_path(path: &str) -> PathBuf {
    let target = Path::new(path);
    let name = target
        .file_name()
        .map_or_else(|| OsString::from("export"), OsStr::to_os_string);

    let mut staged = OsString::from(".");
    staged.push(name);
    staged.push(format!(".{}.tmp", Uuid::new_v4()));

    target.with_file_name(staged)
}

/// The spaces travel with the notes: without them an import would hold an id with
/// nowhere to file it.
#[tauri::command(async)]
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

#[tauri::command(async)]
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

#[tauri::command(async)]
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
#[tauri::command(async)]
#[specta::specta]
pub fn share_notes(ids: Vec<String>, db: State<'_, Db>) -> Result<String, AppError> {
    let mut connection = lock(&db)?;
    let selected = notes::by_ids(&mut connection, &ids)?;
    let names = space_names(&mut connection)?;

    Ok(model::to_markdown(&selected, &names))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::fixtures::note as sample;

    fn bundle() -> Bundle {
        Bundle {
            version: model::FORMAT_VERSION,
            exported_at: sample().created_at,
            spaces: vec![Space {
                id: "s-1".to_string(),
                name: "Personal".to_string(),
            }],
            notes: vec![sample()],
        }
    }

    fn scratch() -> PathBuf {
        let directory = std::env::temp_dir().join(format!("devbox-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();

        directory
    }

    /// A staging file one directory away would make the rename cross volumes, and
    /// with it stop being atomic — the whole point of writing beside the target.
    #[test]
    fn the_staging_file_sits_next_to_its_target() {
        let target = std::env::temp_dir().join("documents").join("library.json");

        let staged = staging_path(&target.to_string_lossy());

        assert_eq!(staged.parent(), target.parent());
        assert_ne!(staged.file_name(), target.file_name());
    }

    #[test]
    fn two_exports_of_the_same_target_never_stage_the_same_file() {
        let target = std::env::temp_dir().join("library.json");

        let first = staging_path(&target.to_string_lossy());
        let second = staging_path(&target.to_string_lossy());

        assert_ne!(first, second);
    }

    #[test]
    fn an_export_leaves_no_staging_file_behind() {
        let directory = scratch();
        let target = directory.join("library.json");

        write(&target.to_string_lossy(), &bundle()).unwrap();

        let left: Vec<_> = std::fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect();

        assert_eq!(left, ["library.json"]);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn exporting_over_an_existing_file_replaces_it_whole() {
        let directory = scratch();
        let target = directory.join("library.json");
        std::fs::write(&target, "previous export, longer than what replaces it").unwrap();

        write(&target.to_string_lossy(), &bundle()).unwrap();

        let written = std::fs::read_to_string(&target).unwrap();
        assert!(written.starts_with('{'));
        assert!(!written.contains("previous export"));
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn an_export_to_an_unreachable_directory_reports_rather_than_panicking() {
        let error = write("/no/such/directory/library.json", &bundle()).unwrap_err();

        assert!(matches!(error.code, crate::error::ErrorCode::FileAccess));
    }
}
