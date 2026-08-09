//! SQLite embarqué, base dans `app_data_dir()`. **Aucune règle métier** : elles
//! sont dans `crate::domain`.

pub mod error;
pub mod migration;
pub mod notes;
pub mod schema;
pub mod spaces;

use std::path::Path;

use diesel::connection::SimpleConnection;
use diesel::prelude::*;

pub use error::StorageError;

pub const DB_FILE_NAME: &str = "devbox.sqlite3";

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

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::sql_types::Integer;

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
}
