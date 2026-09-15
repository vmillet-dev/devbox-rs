pub mod migration;
pub mod schema;

use std::ops::{Deref, DerefMut};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use diesel::connection::SimpleConnection;
use diesel::prelude::*;

use crate::error::StorageError;
use crate::vault::key::Vault;

pub const DB_FILE_NAME: &str = "devbox.sqlite3";

/// The connection, and the key everything it holds is sealed with.
///
/// ⚠️ It derefs to the connection, so a caller keeps writing `&mut connection`. What it
/// does **not** do is stand in for one where Diesel expects it: `load` and its siblings
/// take their connection as a generic parameter, and a generic gets no deref coercion —
/// hence [`Library::db`] at every query.
pub struct Library {
    connection: SqliteConnection,
    vault: Vault,
}

impl Library {
    /// The connection, for the Diesel call that needs it by that name.
    pub fn db(&mut self) -> &mut SqliteConnection {
        &mut self.connection
    }

    /// ⚠️ Both halves at once. Two calls would not do: one borrows mutably and the other
    /// shared, and the compiler cannot see they touch different fields until they are
    /// destructured together.
    pub fn split(&mut self) -> (&mut SqliteConnection, &Vault) {
        (&mut self.connection, &self.vault)
    }

    /// The key. Sealing is the caller's to do — this only hands it over.
    pub fn vault(&self) -> &Vault {
        &self.vault
    }

    /// ⚠️ Hands the closure the connection **and** the key. `SqliteConnection::transaction`
    /// alone gives back a bare connection, which would leave a caller unable to seal
    /// anything inside the transaction it just opened.
    pub fn transaction<T, F>(&mut self, f: F) -> Result<T, StorageError>
    where
        F: FnOnce(&mut SqliteConnection, &Vault) -> Result<T, StorageError>,
    {
        // Split borrows: the connection mutably, the key shared, and they are disjoint
        // fields — which is the whole reason this is destructured rather than chained.
        let Self { connection, vault } = self;
        connection.transaction(|connection| f(connection, vault))
    }
}

impl Deref for Library {
    type Target = SqliteConnection;

    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}

impl DerefMut for Library {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.connection
    }
}

/// ⚠️ Empty until the passphrase has been given. Every command runs behind the front
/// end's unlock gate, so `None` here is a caller that jumped the queue, not a state to
/// render.
pub type Db = Mutex<Option<Library>>;

/// A poisoned mutex means a command panicked while holding it.
pub(crate) fn lock(db: &Db) -> Result<LibraryGuard<'_>, StorageError> {
    let guard = db.lock().map_err(|_| StorageError::Unavailable)?;
    if guard.is_none() {
        return Err(StorageError::Locked);
    }

    Ok(LibraryGuard(guard))
}

/// The guard, narrowed to a library that is definitely there — [`lock`] refused otherwise.
pub(crate) struct LibraryGuard<'a>(MutexGuard<'a, Option<Library>>);

impl Deref for LibraryGuard<'_> {
    type Target = Library;

    fn deref(&self) -> &Self::Target {
        self.0.as_ref().expect("a library checked by lock")
    }
}

impl DerefMut for LibraryGuard<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.0.as_mut().expect("a library checked by lock")
    }
}

pub fn open(path: &Path, vault: Vault) -> Result<Library, StorageError> {
    let mut connection = SqliteConnection::establish(&path.to_string_lossy())
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    configure(&mut connection)?;
    migration::run(&mut connection)?;

    Ok(Library { connection, vault })
}

/// Public for the integration tests, which see nothing of the crate but its API.
pub fn open_in_memory() -> Result<Library, StorageError> {
    let mut connection = SqliteConnection::establish(":memory:")
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    configure(&mut connection)?;
    migration::run(&mut connection)?;

    Ok(Library {
        connection,
        vault: test_vault()?,
    })
}

/// The same key the in-memory libraries use, for the benchmarks, which open a file.
pub fn bench_vault() -> Result<Vault, StorageError> {
    test_vault()
}

/// ⚠️ A key of its own per in-memory library, derived at a cost nobody would ship. These
/// libraries exist for the length of a test and never reach a file, so what matters is
/// that the sealing path is the real one — not that the key is expensive to guess.
pub fn test_vault() -> Result<Vault, StorageError> {
    use crate::vault::key::Cost;

    Vault::derive(
        "in-memory",
        b"0123456789abcdef",
        Cost {
            memory_kib: 64,
            passes: 1,
            lanes: 1,
        },
    )
}

fn configure(connection: &mut SqliteConnection) -> Result<(), StorageError> {
    // ⚠️ `foreign_keys` is set per connection and is off by default: without it the
    // `ON DELETE CASCADE` clauses are inert. `busy_timeout` covers the window where a
    // second process still holds the file, where the default of zero surfaces
    // `SQLITE_BUSY` as a storage error on the very first write.
    connection.batch_execute(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;",
    )?;

    Ok(())
}

/// ⚠️ Milliseconds are always written, even when zero. `created_at` and `updated_at` are
/// TEXT columns sorted lexicographically, and the canvas orders on them: `.` (0x2E)
/// precedes `Z` (0x5A), so `09:00:00.500Z` would sort before `09:00:00Z` — exactly what
/// chrono's default `SecondsFormat::AutoSi` produces.
pub mod iso8601 {
    use chrono::{DateTime, SecondsFormat, Utc};

    pub fn format(instant: DateTime<Utc>) -> String {
        instant.to_rfc3339_opts(SecondsFormat::Millis, true)
    }

    pub fn parse(value: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
        DateTime::parse_from_rfc3339(value).map(|instant| instant.with_timezone(&Utc))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn milliseconds_are_written_even_when_they_are_zero() {
            let instant = parse("2026-07-25T09:00:00Z").unwrap();

            assert_eq!(format(instant), "2026-07-25T09:00:00.000Z");
        }

        #[test]
        fn the_written_form_sorts_the_way_the_column_does() {
            let plain = format(parse("2026-07-25T09:00:00Z").unwrap());
            let with_millis = format(parse("2026-07-25T09:00:00.500Z").unwrap());

            assert!(plain < with_millis);
        }

        #[test]
        fn an_offset_instant_is_normalized_to_utc() {
            let instant = parse("2026-07-25T11:00:00+02:00").unwrap();

            assert_eq!(format(instant), "2026-07-25T09:00:00.000Z");
        }

        #[test]
        fn a_round_trip_keeps_the_instant() {
            let written = "2026-07-25T09:12:34.567Z";

            assert_eq!(format(parse(written).unwrap()), written);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{AppError, ErrorCode};
    use diesel::sql_types::Integer;

    fn in_memory() -> Db {
        Mutex::new(Some(open_in_memory().unwrap()))
    }

    /// Stays here rather than in `tests/`: `configure` is private.
    #[test]
    fn foreign_keys_are_enforced() {
        #[derive(QueryableByName)]
        struct ForeignKeys {
            #[diesel(sql_type = Integer)]
            foreign_keys: i32,
        }

        let mut connection = open_in_memory().unwrap();

        let enabled = diesel::sql_query("PRAGMA foreign_keys")
            .get_result::<ForeignKeys>(connection.db())
            .unwrap()
            .foreign_keys;

        assert_eq!(enabled, 1);
    }

    #[test]
    fn a_healthy_connection_is_handed_over() {
        let db = in_memory();

        assert!(lock(&db).is_ok());
    }

    /// ⚠️ A command that reached the library before the passphrase did. The front gates
    /// on the unlock screen, so this only catches a caller that jumped the queue — but it
    /// answers rather than unwrapping a `None`.
    #[test]
    fn a_library_still_locked_is_reported_rather_than_unwrapped() {
        let db: Db = Mutex::new(None);

        let Err(error) = lock(&db) else {
            panic!("a locked library must be reported, not handed over");
        };

        assert!(matches!(error, StorageError::Locked));
    }

    #[test]
    fn a_poisoned_connection_is_reported_instead_of_panicking_again() {
        let db = in_memory();

        // Poison it the way production would: a panic while the guard is held.
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = db.lock().unwrap();
            panic!("a command panicked while holding the connection");
        }));
        std::panic::set_hook(hook);

        // `unwrap_err()` would need the guard to be `Debug`, which `SqliteConnection`
        // is not.
        let Err(error) = lock(&db) else {
            panic!("a poisoned mutex must be reported, not returned");
        };

        assert!(matches!(error, StorageError::Unavailable));
        assert!(matches!(
            AppError::from(error).code,
            ErrorCode::StorageUnavailable
        ));
    }
}
