//! A rolling copy of the library, taken at launch.
//!
//! ⚠️ The trash protects a note from being deleted; nothing protected the **file**. A
//! dead disk, a botched migration or an emptied trash took the library with it, and an
//! export only helps the person who remembered to make one.
//!
//! ⚠️ `VACUUM INTO` rather than a file copy: under WAL the database file on its own is
//! not a consistent snapshot — the committed pages may still be in the write-ahead log —
//! so copying it can produce something that opens short of what was written.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use chrono::{DateTime, TimeDelta, Utc};
use diesel::prelude::*;
use diesel::sql_types::Text;

use crate::db::{DB_FILE_NAME, Library};
use crate::error::StorageError;
use crate::vault::file::FILE_NAME as VAULT_FILE_NAME;
use crate::vault::key::{Cost, Vault};

pub(crate) const DIRECTORY: &str = "backups";

/// Where the front end writes its preferences, and the key it writes this one under.
const PREFERENCES: &str = "preferences.json";
const SETTING: &str = "devbox.automaticBackups";

/// How many are kept. Enough to reach past the launch that went wrong without turning the
/// data directory into a second library.
pub(crate) const KEEP: usize = 3;

/// ⚠️ At most one a day, not one per launch: five launches in an hour would otherwise
/// rotate every older copy out, which is exactly the history a backup is for.
const MIN_AGE: TimeDelta = TimeDelta::hours(24);

/// ⚠️ Colons are legal in an instant and not in a Windows path.
fn stamp(now: DateTime<Utc>) -> String {
    now.format("%Y-%m-%d_%H-%M-%S").to_string()
}

fn taken_at(entry: &Path) -> Option<DateTime<Utc>> {
    let name = entry.file_name()?.to_str()?;
    let parsed = chrono::NaiveDateTime::parse_from_str(name, "%Y-%m-%d_%H-%M-%S").ok()?;

    Some(parsed.and_utc())
}

/// The copies on disk, newest first.
fn existing(directory: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };

    let mut taken: Vec<(DateTime<Utc>, PathBuf)> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter_map(|path| taken_at(&path).map(|at| (at, path)))
        .collect();

    // Newest first, which is the order both the age check and the pruning want.
    taken.sort_by_key(|(at, _)| std::cmp::Reverse(*at));

    taken.into_iter().map(|(_, path)| path).collect()
}

/// Takes one if the newest is older than a day, then prunes to [`KEEP`].
///
/// ⚠️ The key file travels with the database, and must: the library is sealed, and a
/// copy of it without `vault.json` is a file nobody can ever open again.
pub(crate) fn rotate(
    library: &Path,
    connection: &mut Library,
    now: DateTime<Utc>,
) -> Result<Option<PathBuf>, StorageError> {
    let directory = library.join(DIRECTORY);
    let taken = existing(&directory);

    if let Some(newest) = taken.first()
        && let Some(at) = taken_at(newest)
        && now.signed_duration_since(at) < MIN_AGE
    {
        return Ok(None);
    }

    let target = directory.join(stamp(now));
    std::fs::create_dir_all(&target)
        .map_err(|error| StorageError::File(format!("{}: {error}", target.display())))?;

    let copy = target.join(DB_FILE_NAME);
    diesel::sql_query("VACUUM INTO ?")
        .bind::<Text, _>(copy.to_string_lossy().to_string())
        .execute(connection.db())
        .map_err(|error| {
            // A half-written copy is worse than none: it would be the newest, and would
            // hold the next day's rotation off.
            let _ = std::fs::remove_dir_all(&target);
            StorageError::File(format!("{}: {error}", copy.display()))
        })?;

    std::fs::copy(library.join(VAULT_FILE_NAME), target.join(VAULT_FILE_NAME)).map_err(
        |error| {
            let _ = std::fs::remove_dir_all(&target);
            StorageError::File(format!("{VAULT_FILE_NAME}: {error}"))
        },
    )?;

    for old in existing(&directory).into_iter().skip(KEEP) {
        // Best effort: a copy that resists deletion is not worth failing a launch over.
        let _ = std::fs::remove_dir_all(old);
    }

    Ok(Some(target))
}

/// What [`rewrap`] managed. ⚠️ `left` is not a failure to report as one: refusing to
/// rotate the phrase because a backup's file is locked would block the revocation at the
/// moment it is asked for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Rewrapped {
    pub(crate) done: usize,
    pub(crate) left: usize,
}

/// Rewraps every retained copy's key file under the new phrase.
///
/// ⚠️ This is what makes changing the passphrase revoke anything. `backups/` sits **inside
/// the profile it copies**, so whoever copies the profile copies every phrase the user has
/// ever retired — and the envelope means one master key for the life of the library, so any
/// key file ever written is a permanent escrow for it (#157).
///
/// ⚠️ It writes the key it is **given** rather than opening each copy with the old phrase:
/// a backup's file wraps that same master key whatever phrase was current when it was
/// taken, so this revokes *every* retired phrase rather than only the last one. A copy
/// with no key file predates the library being sealed and is left alone.
///
/// `damaged/` is deliberately absent: `recovery::set_aside` leaves `vault.json` where it
/// is, so a set-aside library has no wrapping of its own to retire.
pub(crate) fn rewrap(library: &Path, vault: &Vault, passphrase: &str, cost: Cost) -> Rewrapped {
    let mut tally = Rewrapped::default();

    for copy in existing(&library.join(DIRECTORY)) {
        let path = copy.join(VAULT_FILE_NAME);
        if !path.is_file() {
            continue;
        }

        // Staged and renamed by `write_wrapped`: a key file half written is a backup lost.
        match crate::vault::file::write_wrapped(&path, vault, passphrase, cost) {
            Ok(()) => tally.done += 1,
            Err(error) => {
                log::warn!(
                    "{}: still opens with the old passphrase: {error}",
                    path.display()
                );
                tally.left += 1;
            }
        }
    }

    tally
}

/// ⚠️ Anything but a plain `"false"` keeps the copies. A preferences file that is
/// missing, truncated, or written by a version that spells this differently must not
/// silently switch a safety net off — the only thing that turns it off is somebody
/// turning it off.
pub(crate) fn wanted(stored: Option<&str>) -> bool {
    stored != Some("false")
}

/// ⚠️ Read from the preferences file rather than handed over by the front end: the copy
/// is taken at unlock, before the front has booted far enough to tell anyone anything.
fn wanted_by_preference(app: &AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;

    let stored = app
        .store(PREFERENCES)
        .ok()
        .and_then(|store| store.get(SETTING))
        .and_then(|value| value.as_str().map(str::to_owned));

    wanted(stored.as_deref())
}

/// The launch copy. ⚠️ Never fatal and never in the way: a library that cannot be
/// copied still has to open.
pub(crate) fn take(app: &AppHandle, db: &crate::db::Db) {
    if !wanted_by_preference(app) {
        return;
    }

    let Ok(directory) = app.path().app_data_dir() else {
        return;
    };

    let mut connection = match crate::db::lock(db) {
        Ok(connection) => connection,
        Err(error) => {
            log::warn!("No backup taken: {error}");
            return;
        }
    };

    match rotate(&directory, &mut connection, Utc::now()) {
        Ok(Some(target)) => log::info!("Library copied to {}", target.display()),
        Ok(None) => {}
        Err(error) => log::warn!("No backup taken: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::notes::store as notes;
    use crate::spaces::store as spaces;

    fn scratch() -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("devbox-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();

        directory
    }

    /// ⚠️ The shipped cost is ~52 ms a derivation and these tests derive a dozen times.
    fn cheap() -> Cost {
        Cost {
            memory_kib: 64,
            passes: 1,
            lanes: 1,
        }
    }

    fn at(offset_hours: i64) -> DateTime<Utc> {
        db::iso8601::parse("2026-07-25T09:00:00.000Z").unwrap() + TimeDelta::hours(offset_hours)
    }

    /// A library with one note in it, and the key file beside it, as a real one is.
    fn library(directory: &Path) -> (Library, String) {
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
        let space = spaces::create(&mut connection, "Perso").unwrap().id;
        let note = notes::create(
            &mut connection,
            crate::notes::model::NoteDraft {
                space_id: space,
                folder_id: None,
                title: "À sauvegarder".to_string(),
                language: crate::notes::language::Language::Txt,
                content: "psql -h prod".to_string(),
                source: String::new(),
                tags: Vec::new(),
                pinned: false,
                lifecycle: crate::notes::model::NoteLifecycle::Permanent,
                kind: crate::notes::checklist::NoteKind::Snippet,
                items: Vec::new(),
            },
            at(0),
        )
        .unwrap()
        .id;

        (connection, note)
    }

    /// ⚠️ The only test that matters: a copy that cannot be opened is not a backup.
    #[test]
    fn a_copy_opens_as_a_library_and_holds_the_notes() {
        let directory = scratch();
        let (mut connection, note_id) = library(&directory);

        let target = rotate(&directory, &mut connection, at(0)).unwrap().unwrap();

        let reopened = crate::vault::file::unlock(&target, "a passphrase").unwrap();
        let mut copy = db::open(&target.join(DB_FILE_NAME), reopened).unwrap();
        let written = notes::all(&mut copy, None).unwrap();

        assert_eq!(written.len(), 1);
        assert_eq!(written[0].id, note_id);
        assert_eq!(written[0].title, "À sauvegarder");
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ Without the key file the copy is a file nobody can ever open again.
    #[test]
    fn the_key_file_travels_with_the_database() {
        let directory = scratch();
        let (mut connection, _) = library(&directory);

        let target = rotate(&directory, &mut connection, at(0)).unwrap().unwrap();

        assert!(target.join(VAULT_FILE_NAME).is_file());
        assert!(target.join(DB_FILE_NAME).is_file());
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ Five launches in an hour must not rotate the history out.
    #[test]
    fn a_second_launch_the_same_day_takes_nothing() {
        let directory = scratch();
        let (mut connection, _) = library(&directory);
        rotate(&directory, &mut connection, at(0)).unwrap().unwrap();

        let again = rotate(&directory, &mut connection, at(3)).unwrap();

        assert!(again.is_none());
        assert_eq!(existing(&directory.join(DIRECTORY)).len(), 1);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_launch_the_next_day_takes_another() {
        let directory = scratch();
        let (mut connection, _) = library(&directory);
        rotate(&directory, &mut connection, at(0)).unwrap();

        rotate(&directory, &mut connection, at(25))
            .unwrap()
            .unwrap();

        assert_eq!(existing(&directory.join(DIRECTORY)).len(), 2);
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn only_the_last_few_are_kept() {
        let directory = scratch();
        let (mut connection, _) = library(&directory);

        for day in 0..6 {
            rotate(&directory, &mut connection, at(day * 25)).unwrap();
        }

        let kept = existing(&directory.join(DIRECTORY));
        assert_eq!(kept.len(), KEEP);
        // The newest survive, not the first ones taken.
        assert_eq!(taken_at(&kept[0]).unwrap(), at(5 * 25));
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ Fail safe: only a deliberate "false" stops the copies.
    #[test]
    fn only_a_preference_turning_them_off_turns_them_off() {
        assert!(wanted(Some("true")));
        assert!(wanted(None), "a missing preference keeps the copies");
        assert!(wanted(Some("")), "a truncated value keeps them too");
        assert!(wanted(Some("False")), "and anything this build cannot read");

        assert!(!wanted(Some("false")));
    }

    /// ⚠️ The point of #157. Changing the passphrase is the gesture somebody makes when
    /// they believe the old one leaked, and every retained copy kept a key file still
    /// wrapped under it — in the same profile directory. It revoked nothing.
    #[test]
    fn changing_the_passphrase_stops_the_old_one_opening_a_backup() {
        let directory = scratch();
        let (mut connection, _) = library(&directory);
        let target = rotate(&directory, &mut connection, at(0)).unwrap().unwrap();

        let vault =
            crate::vault::file::change_passphrase(&directory, "a passphrase", "a new one", cheap())
                .unwrap();

        // The gap itself, kept in the test: rewrapping the live file alone revokes nothing.
        crate::vault::file::unlock(&target, "a passphrase")
            .expect("the copy still opens with the retired phrase before the rewrap");

        let tally = rewrap(&directory, &vault, "a new one", cheap());

        assert_eq!(tally, Rewrapped { done: 1, left: 0 });
        assert!(
            crate::vault::file::unlock(&target, "a passphrase").is_err(),
            "the retired passphrase still opens the backup"
        );
        // And the copy is not merely shut: it opens under the new one, on the same key.
        crate::vault::file::unlock(&target, "a new one").unwrap();
        std::fs::remove_dir_all(&directory).ok();
    }

    /// ⚠️ Every retired phrase, not only the last: a copy is rewrapped from the key the
    /// live file just gave up, so one taken two changes ago is reached as well. Opening
    /// each copy with the phrase being retired would have missed exactly this one.
    #[test]
    fn a_copy_left_over_from_an_older_phrase_is_reached_too() {
        let directory = scratch();
        let (mut connection, _) = library(&directory);
        let first = rotate(&directory, &mut connection, at(0)).unwrap().unwrap();

        let vault = crate::vault::file::change_passphrase(
            &directory,
            "a passphrase",
            "the second",
            cheap(),
        )
        .unwrap();
        // ⚠️ No rewrap here, so the first copy stays under the very first phrase.
        let second = rotate(&directory, &mut connection, at(25))
            .unwrap()
            .unwrap();
        crate::vault::file::write_wrapped(
            &second.join(VAULT_FILE_NAME),
            &vault,
            "the second",
            cheap(),
        )
        .unwrap();

        let vault =
            crate::vault::file::change_passphrase(&directory, "the second", "the third", cheap())
                .unwrap();
        let tally = rewrap(&directory, &vault, "the third", cheap());

        assert_eq!(tally.done, 2);
        for copy in [&first, &second] {
            assert!(crate::vault::file::unlock(copy, "a passphrase").is_err());
            assert!(crate::vault::file::unlock(copy, "the second").is_err());
            crate::vault::file::unlock(copy, "the third").unwrap();
        }
        std::fs::remove_dir_all(&directory).ok();
    }

    /// A copy taken before the library was sealed has no key file to retire.
    #[test]
    fn a_copy_with_no_key_file_is_left_alone_rather_than_counted() {
        let directory = scratch();
        let (mut connection, _) = library(&directory);
        let target = rotate(&directory, &mut connection, at(0)).unwrap().unwrap();
        std::fs::remove_file(target.join(VAULT_FILE_NAME)).unwrap();

        let vault = crate::vault::file::unlock(&directory, "a passphrase").unwrap();
        let tally = rewrap(&directory, &vault, "a new one", cheap());

        assert_eq!(tally, Rewrapped { done: 0, left: 0 });
        std::fs::remove_dir_all(&directory).ok();
    }

    /// A directory somebody dropped in there is not a backup, and must not hold the
    /// rotation off by looking like the newest one.
    #[test]
    fn something_that_is_not_a_copy_is_ignored() {
        let directory = scratch();
        let (mut connection, _) = library(&directory);
        std::fs::create_dir_all(directory.join(DIRECTORY).join("notes de Valentin")).unwrap();

        let target = rotate(&directory, &mut connection, at(0)).unwrap();

        assert!(target.is_some());
        std::fs::remove_dir_all(&directory).ok();
    }
}
