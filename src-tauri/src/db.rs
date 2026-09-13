pub mod migration;
pub mod schema;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use diesel::connection::SimpleConnection;
use diesel::prelude::*;

use crate::error::{AppError, StorageError};

pub const DB_FILE_NAME: &str = "devbox.sqlite3";

/// `SqliteConnection` is not `Sync`: overlapping commands serialise on this mutex.
pub type Db = Mutex<SqliteConnection>;

/// A poisoned mutex means a command panicked while holding it: better to say so
/// than to panic again.
pub(crate) fn lock(db: &Db) -> Result<MutexGuard<'_, SqliteConnection>, AppError> {
    db.lock().map_err(|_| AppError::storage_unavailable())
}

pub fn open(path: &Path) -> Result<SqliteConnection, StorageError> {
    let mut connection = SqliteConnection::establish(&path.to_string_lossy())
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    configure(&mut connection)?;
    migration::run(&mut connection)?;

    Ok(connection)
}

/// Public for the integration tests, which see nothing of the crate but its API.
pub fn open_in_memory() -> Result<SqliteConnection, StorageError> {
    let mut connection = SqliteConnection::establish(":memory:")
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    configure(&mut connection)?;
    migration::run(&mut connection)?;

    Ok(connection)
}

fn configure(connection: &mut SqliteConnection) -> Result<(), StorageError> {
    // ⚠️ `foreign_keys` is set **per connection** and is off by default: without it
    // the `ON DELETE CASCADE` clauses are inert. WAL: a reader no longer blocks a writer.
    //
    // `busy_timeout` covers the window where a second process still holds the file —
    // a stale instance shutting down, a backup tool reading it — where the default of
    // zero surfaces `SQLITE_BUSY` as a storage error on the very first write.
    connection.batch_execute(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;",
    )?;

    Ok(())
}

/// ⚠️ Milliseconds are always written, even when zero. `created_at` and `updated_at`
/// are TEXT columns sorted lexicographically, and the canvas orders on them: `.`
/// (0x2E) precedes `Z` (0x5A), so `09:00:00.500Z` would sort **before** `09:00:00Z`
/// — exactly what chrono's default `SecondsFormat::AutoSi` produces.
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
        fn an_offset_instant_is_normalised_to_utc() {
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
    use crate::error::ErrorCode;
    use diesel::sql_types::Integer;

    fn in_memory() -> Db {
        Mutex::new(SqliteConnection::establish(":memory:").unwrap())
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
            .get_result::<ForeignKeys>(&mut connection)
            .unwrap()
            .foreign_keys;

        assert_eq!(enabled, 1);
    }

    #[test]
    fn a_healthy_connection_is_handed_over() {
        let db = in_memory();

        assert!(lock(&db).is_ok());
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
        // is not; and `unwrap()` in `lock` would take the process down on the next command.
        let Err(error) = lock(&db) else {
            panic!("a poisoned mutex must be reported, not returned");
        };

        assert!(matches!(error.code, ErrorCode::StorageUnavailable));
    }
}
