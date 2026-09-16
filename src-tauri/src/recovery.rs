//! What to do with a library that will not open.
//!
//! ⚠️ Detection without a way out is a loop: an application that refuses to start and
//! tells you why, every time, leaves deleting a file by hand as the only move. So this
//! is the other half of the check — set the damaged library aside, rescue what SQLite
//! will still hand over, and let the next launch start clean.

#![allow(clippy::needless_pass_by_value)]

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use diesel::prelude::*;
use diesel::sql_types::Text;
use tauri::{AppHandle, Manager, State};

use crate::db::{DB_FILE_NAME, Db};
use crate::error::{AppError, StorageError};

/// Where a library that would not open goes.
pub(crate) const DIRECTORY: &str = "damaged";

/// The attachments directory, moved with the database it belongs to.
const ATTACHMENTS: &str = "attachments";

/// What SQLite leaves beside the database; they belong to it and must travel with it.
const SIDECARS: [&str; 2] = ["devbox.sqlite3-wal", "devbox.sqlite3-shm"];

/// The name the rescued copy takes, beside the file it was rescued from.
const RESCUED: &str = "rescued.sqlite3";

fn stamp(now: DateTime<Utc>) -> String {
    now.format("%Y-%m-%d_%H-%M-%S").to_string()
}

/// ⚠️ Best effort and deliberately so: `VACUUM INTO` on a partly readable database often
/// rescues most of it, and when it cannot, the damaged original is still set aside. A
/// failure here must not stop the user getting a working application back.
fn rescue(damaged: &Path, into: &Path) -> Option<PathBuf> {
    let mut connection = SqliteConnection::establish(&damaged.to_string_lossy()).ok()?;
    let target = into.join(RESCUED);

    diesel::sql_query("VACUUM INTO ?")
        .bind::<Text, _>(target.to_string_lossy().to_string())
        .execute(&mut connection)
        .ok()?;

    Some(target)
}

/// Moves the damaged library aside and leaves the directory ready for a fresh one.
///
/// ⚠️ The attachments go with it. They are files the database points at, and a fresh
/// library would call every one of them an orphan — the startup sweep would then delete
/// the pictures belonging to the notes just set aside.
///
/// ⚠️ `vault.json` stays. The passphrase is unchanged, the rescued copy needs that exact
/// key to open, and asking someone to choose a new passphrase in the middle of losing
/// their library would be its own small cruelty.
pub(crate) fn set_aside(directory: &Path, now: DateTime<Utc>) -> Result<PathBuf, StorageError> {
    let database = directory.join(DB_FILE_NAME);
    if !database.exists() {
        return Err(StorageError::File(format!(
            "{}: nothing to set aside",
            database.display()
        )));
    }

    let target = directory.join(DIRECTORY).join(stamp(now));
    std::fs::create_dir_all(&target)
        .map_err(|error| StorageError::File(format!("{}: {error}", target.display())))?;

    // Before the move, while the file is still where SQLite expects its sidecars.
    rescue(&database, &target);

    std::fs::rename(&database, target.join(DB_FILE_NAME))
        .map_err(|error| StorageError::File(format!("{}: {error}", database.display())))?;

    for sidecar in SIDECARS {
        // Absent is the ordinary case: a clean shutdown leaves neither.
        let _ = std::fs::rename(directory.join(sidecar), target.join(sidecar));
    }

    let attachments = directory.join(ATTACHMENTS);
    if attachments.is_dir() {
        std::fs::rename(&attachments, target.join(ATTACHMENTS))
            .map_err(|error| StorageError::File(format!("{}: {error}", attachments.display())))?;
    }

    Ok(target)
}

/// Sets the damaged library aside so the next unlock starts on a fresh one.
///
/// ⚠️ Answers the folder it moved everything into, and the interface says it out loud:
/// "set aside" is only true if the user can be told where.
#[tauri::command(async)]
#[specta::specta]
pub fn set_aside_damaged_library(app: AppHandle, db: State<'_, Db>) -> Result<String, AppError> {
    // ⚠️ Refused on an open library: this only answers the case where opening failed, and
    // moving the file under a live connection is how a damaged database becomes a lost one.
    if db.lock().map_err(|_| StorageError::Unavailable)?.is_some() {
        return Err(StorageError::File("the library is open".to_string()).into());
    }

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| StorageError::File(error.to_string()))?;

    let target = set_aside(&directory, Utc::now())?;

    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::vault::file::FILE_NAME as VAULT_FILE_NAME;

    fn scratch() -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("devbox-recovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();

        directory
    }

    fn at() -> DateTime<Utc> {
        db::iso8601::parse("2026-07-25T09:00:00.000Z").unwrap()
    }

    /// A library as one really sits on disk: a database, its key file, and a picture.
    fn library(directory: &Path) -> String {
        let vault = crate::vault::file::create(
            directory,
            "a passphrase",
            crate::vault::key::Cost {
                memory_kib: 64,
                passes: 1,
                lanes: 1,
            },
        )
        .unwrap();

        let mut connection = db::open(&directory.join(DB_FILE_NAME), vault).unwrap();
        let space = crate::spaces::store::create(&mut connection, "Perso")
            .unwrap()
            .id;

        std::fs::create_dir_all(directory.join(ATTACHMENTS)).unwrap();
        std::fs::write(directory.join(ATTACHMENTS).join("a-1.png"), b"\x89PNG").unwrap();

        space
    }

    #[test]
    fn the_database_leaves_and_the_directory_is_ready_for_a_new_one() {
        let directory = scratch();
        library(&directory);

        let target = set_aside(&directory, at()).unwrap();

        assert!(!directory.join(DB_FILE_NAME).exists());
        assert!(target.join(DB_FILE_NAME).is_file());
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ Or the next launch's orphan sweep deletes the pictures of the notes just set
    /// aside — the one way this recovery could destroy what it was meant to save.
    #[test]
    fn the_attachments_go_with_the_database_they_belong_to() {
        let directory = scratch();
        library(&directory);

        let target = set_aside(&directory, at()).unwrap();

        assert!(!directory.join(ATTACHMENTS).exists());
        assert!(target.join(ATTACHMENTS).join("a-1.png").is_file());
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ The passphrase is unchanged, and the rescued copy needs that exact key.
    #[test]
    fn the_key_file_stays_where_it_was() {
        let directory = scratch();
        library(&directory);

        set_aside(&directory, at()).unwrap();

        assert!(directory.join(VAULT_FILE_NAME).is_file());
        std::fs::remove_dir_all(&directory).ok();
    }

    /// What is rescued is a real library: the point of trying `VACUUM INTO` at all.
    #[test]
    fn what_could_be_read_is_rescued_beside_it() {
        let directory = scratch();
        let space = library(&directory);

        let target = set_aside(&directory, at()).unwrap();

        let vault = crate::vault::file::unlock(&directory, "a passphrase").unwrap();
        let mut rescued = db::open(&target.join(RESCUED), vault).unwrap();
        let spaces = crate::spaces::store::list(&mut rescued).unwrap();

        assert_eq!(spaces.len(), 1);
        assert_eq!(spaces[0].id, space);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_fresh_library_opens_in_its_place() {
        let directory = scratch();
        library(&directory);
        set_aside(&directory, at()).unwrap();

        let vault = crate::vault::file::unlock(&directory, "a passphrase").unwrap();
        let mut fresh = db::open(&directory.join(DB_FILE_NAME), vault).unwrap();

        assert!(crate::spaces::store::list(&mut fresh).unwrap().is_empty());
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn setting_aside_nothing_says_so_rather_than_pretending() {
        let directory = scratch();

        assert!(set_aside(&directory, at()).is_err());
        std::fs::remove_dir_all(&directory).ok();
    }
}
