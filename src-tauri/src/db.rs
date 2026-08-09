//! La base : ouverture, configuration, migrations, et l'accès partagé que les
//! commandes verrouillent.
//!
//! **Aucune règle métier** : elles vivent dans `notes::model`, `notes::view` et
//! `spaces::model`, qui se testent sans ouvrir de base.

pub mod migration;
pub mod schema;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use diesel::connection::SimpleConnection;
use diesel::prelude::*;

use crate::error::{AppError, StorageError};

pub const DB_FILE_NAME: &str = "devbox.sqlite3";

/// `SqliteConnection` n'est pas `Sync` : deux commandes qui se chevauchent se
/// sérialisent sur ce mutex.
pub type Db = Mutex<SqliteConnection>;

/// Un mutex empoisonné signifie qu'une commande a paniqué en le tenant : mieux
/// vaut le dire que paniquer à nouveau.
pub(crate) fn lock(db: &Db) -> Result<MutexGuard<'_, SqliteConnection>, AppError> {
    db.lock().map_err(|_| AppError::storage_unavailable())
}

/// Ouvre la base (en la créant au besoin), la configure, migre.
pub fn open(path: &Path) -> Result<SqliteConnection, StorageError> {
    let mut connection = SqliteConnection::establish(&path.to_string_lossy())
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    configure(&mut connection)?;
    migration::run(&mut connection)?;

    Ok(connection)
}

/// Base éphémère. Publique pour les tests d'intégration, qui ne voient du crate
/// que son API.
pub fn open_in_memory() -> Result<SqliteConnection, StorageError> {
    let mut connection = SqliteConnection::establish(":memory:")
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    configure(&mut connection)?;
    migration::run(&mut connection)?;

    Ok(connection)
}

fn configure(connection: &mut SqliteConnection) -> Result<(), StorageError> {
    // ⚠️ `foreign_keys` se règle **par connexion** et est désactivé par défaut :
    // sans lui les `ON DELETE CASCADE` sont inertes et les tags d'une note
    // supprimée resteraient orphelins. WAL : un lecteur ne bloque plus un écrivain.
    connection.batch_execute(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )?;

    Ok(())
}

/// Format des instants **stockés**, et sa lecture.
///
/// ⚠️ Les millisecondes sont toujours écrites, même nulles. `created_at` et
/// `updated_at` sont des colonnes TEXT triées lexicographiquement, et le canevas
/// s'ordonne dessus : `.` (0x2E) précédant `Z` (0x5A), un `09:00:00.500Z`
/// passerait **avant** un `09:00:00Z`. `SecondsFormat::AutoSi`, le défaut de
/// chrono, tombe précisément dans ce piège.
///
/// Le fil, lui, n'en dépend pas : le front convertit en `Date` à la frontière.
pub mod iso8601 {
    use chrono::{DateTime, SecondsFormat, Utc};

    /// `2026-07-25T09:12:00.000Z`.
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
            // This is the whole point: the canvas orders on a lexicographic TEXT
            // comparison, so the shorter form would sort *after* a longer one of the
            // same second.
            let plain = format(parse("2026-07-25T09:00:00Z").unwrap());
            let with_millis = format(parse("2026-07-25T09:00:00.500Z").unwrap());

            assert!(plain < with_millis);
        }

        #[test]
        fn an_offset_instant_is_normalised_to_utc() {
            // A column read as UTC but holding a local time would shift the note by
            // hours; normalising on the way in is what makes the comparison sound.
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

    /// Reste ici plutôt que dans `tests/` : `configure` est privée.
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
        // The hook is silenced so a deliberate panic does not look like a crash.
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = db.lock().unwrap();
            panic!("une commande a paniqué en tenant la connexion");
        }));
        std::panic::set_hook(hook);

        // `unwrap_err()` would need the guard to be `Debug`, which
        // `SqliteConnection` is not; and `unwrap()` in `lock` itself would take
        // the whole process down on the next command.
        let Err(error) = lock(&db) else {
            panic!("un mutex empoisonné doit être signalé, pas rendu");
        };

        assert!(matches!(error.code, ErrorCode::StorageUnavailable));
    }
}
