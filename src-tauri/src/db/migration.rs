//! Applying the embedded migrations, and adopting legacy databases.
//!
//! ⚠️ **Append-only.** Evolving the model means adding a
//! `migrations/YYYY-MM-DD-HHMMSS_name/` directory, never editing a shipped
//! migration.

use diesel::migration::MigrationSource;
use diesel::prelude::*;
use diesel::sql_types::{Integer, Text};
use diesel::sqlite::Sqlite;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

use crate::error::StorageError;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// The highest value the old `PRAGMA user_version` ever shipped. It never moves
/// again: a migration added today never existed under the old scheme.
const LEGACY_MIGRATION_COUNT: usize = 3;

#[derive(QueryableByName)]
struct UserVersion {
    #[diesel(sql_type = Integer)]
    user_version: i32,
}

fn embedded_versions() -> Result<Vec<String>, StorageError> {
    let mut versions = MigrationSource::<Sqlite>::migrations(&MIGRATIONS)
        .map_err(|error| StorageError::Migration(error.to_string()))?
        .iter()
        .map(|migration| migration.name().version().to_string())
        .collect::<Vec<_>>();
    versions.sort();

    Ok(versions)
}

/// Makes Diesel adopt the history the old `PRAGMA user_version` used to write.
///
/// Without it, an already installed database would replay the initial migration
/// over existing tables. The first `n` are therefore marked as applied without
/// being executed, and the pragma is zeroed — two sources of truth on the schema
/// state would end up drifting apart.
fn adopt_legacy_history(
    connection: &mut SqliteConnection,
    embedded: &[String],
) -> Result<(), StorageError> {
    let legacy: i32 = diesel::sql_query("PRAGMA user_version")
        .get_result::<UserVersion>(connection)?
        .user_version;

    // Zero: a fresh database, or one that came through here on an earlier open.
    if legacy <= 0 {
        return Ok(());
    }

    // Creates `__diesel_schema_migrations` if it is missing — the insert follows.
    connection
        .applied_migrations()
        .map_err(|error| StorageError::Migration(error.to_string()))?;

    let adopted = usize::try_from(legacy)
        .unwrap_or(0)
        .min(LEGACY_MIGRATION_COUNT)
        .min(embedded.len());

    connection.transaction(|connection| {
        for version in &embedded[..adopted] {
            diesel::sql_query(
                "INSERT OR IGNORE INTO __diesel_schema_migrations (version) VALUES (?)",
            )
            .bind::<Text, _>(version)
            .execute(connection)?;
        }
        diesel::sql_query("PRAGMA user_version = 0").execute(connection)?;

        Ok::<_, StorageError>(())
    })
}

pub fn run(connection: &mut SqliteConnection) -> Result<(), StorageError> {
    let embedded = embedded_versions()?;

    adopt_legacy_history(connection, &embedded)?;

    // An applied migration we do not know about signals a database written by a
    // newer version: refusing beats overwriting its data.
    let applied = connection
        .applied_migrations()
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    if let Some(unknown) = applied
        .iter()
        .map(ToString::to_string)
        .find(|version| !embedded.contains(version))
    {
        return Err(StorageError::SchemaTooRecent(unknown));
    }

    connection
        .run_pending_migrations(MIGRATIONS)
        .map_err(|error| StorageError::Migration(error.to_string()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use diesel::connection::SimpleConnection;
    use diesel::sql_types::BigInt;

    use super::*;
    use crate::db::{DB_FILE_NAME, configure, open, open_in_memory, schema};
    use crate::error::StorageError;

    /// The SQL of the initial migration exactly as it shipped. Replayed by hand,
    /// it builds a "legacy" database: schema in place, `user_version` set, no
    /// trace on the Diesel side.
    const LEGACY_SCHEMA: &str = include_str!("../../migrations/2026-07-25-000001_initial/up.sql");
    const LEGACY_FOLD_TAG_CASE: &str =
        include_str!("../../migrations/2026-07-25-000002_fold_tag_case/up.sql");

    #[derive(QueryableByName)]
    struct Count {
        #[diesel(sql_type = BigInt)]
        count: i64,
    }

    fn count(connection: &mut SqliteConnection, query: &str) -> i64 {
        diesel::sql_query(query)
            .get_result::<Count>(connection)
            .unwrap()
            .count
    }

    fn user_version(connection: &mut SqliteConnection) -> i32 {
        diesel::sql_query("PRAGMA user_version")
            .get_result::<UserVersion>(connection)
            .unwrap()
            .user_version
    }

    /// A database on the original schema, versioned the way the old code did it.
    fn legacy_database(sql: &[&str], version: i32) -> SqliteConnection {
        let mut connection = SqliteConnection::establish(":memory:").unwrap();
        configure(&mut connection).unwrap();
        for statements in sql {
            connection.batch_execute(statements).unwrap();
        }
        connection
            .batch_execute(&format!("PRAGMA user_version = {version}"))
            .unwrap();

        connection
    }

    #[test]
    fn opening_twice_is_idempotent() {
        let directory = std::env::temp_dir().join(format!("devbox-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(DB_FILE_NAME);

        open(&path).unwrap();
        // A second open must find every migration already applied and not
        // attempt to re-create the tables.
        let mut connection = open(&path).unwrap();

        assert!(!connection.has_pending_migration(MIGRATIONS).unwrap());

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_fresh_database_applies_every_embedded_migration() {
        let mut connection = open_in_memory().unwrap();

        let applied = connection.applied_migrations().unwrap();
        assert_eq!(applied.len(), embedded_versions().unwrap().len());
    }

    #[test]
    fn a_v1_database_upgrades_and_folds_tag_case() {
        let mut connection = legacy_database(
            &[
                LEGACY_SCHEMA,
                "INSERT INTO spaces (id, name) VALUES ('s-1', 'Perso');
                     INSERT INTO notes VALUES
                       ('n-1', 's-1', 'A', 'txt', '', '', 0, '2026-07-25T09:00:00.000Z',
                        '2026-07-25T09:00:00.000Z', 'permanent', NULL),
                       ('n-2', 's-1', 'B', 'txt', '', '', 0, '2026-07-25T09:00:00.000Z',
                        '2026-07-25T09:00:00.000Z', 'permanent', NULL);
                     INSERT INTO note_tags VALUES ('n-1', 'Urgent'), ('n-2', 'urgent');",
            ],
            1,
        );

        // Passing at all is half the assertion: replaying the initial migration
        // on these tables would fail on `CREATE TABLE spaces`.
        run(&mut connection).unwrap();

        assert!(!connection.has_pending_migration(MIGRATIONS).unwrap());

        // Both rows survive: the collation folds the facet, it does not drop data.
        assert_eq!(
            count(&mut connection, "SELECT COUNT(*) AS count FROM note_tags"),
            2
        );

        // But the rail now sees one tag where it used to see two.
        assert_eq!(
            count(
                &mut connection,
                "SELECT COUNT(*) AS count FROM (SELECT DISTINCT tag FROM note_tags)"
            ),
            1
        );
    }

    #[test]
    fn a_v2_database_gains_the_language_index_without_touching_its_notes() {
        let mut connection = legacy_database(
            &[
                LEGACY_SCHEMA,
                LEGACY_FOLD_TAG_CASE,
                "INSERT INTO spaces (id, name) VALUES ('s-1', 'Perso');
                     INSERT INTO notes VALUES
                       ('n-1', 's-1', 'A', 'json', '', '', 0, '2026-07-25T09:00:00.000Z',
                        '2026-07-25T09:00:00.000Z', 'permanent', NULL);",
            ],
            2,
        );

        run(&mut connection).unwrap();

        assert!(!connection.has_pending_migration(MIGRATIONS).unwrap());
        assert_eq!(
            count(
                &mut connection,
                "SELECT COUNT(*) AS count FROM sqlite_master \
                     WHERE type = 'index' AND name = 'notes_language'"
            ),
            1
        );

        // The migration is an index, not a rewrite: the note is untouched.
        assert_eq!(
            schema::notes::table
                .select(schema::notes::language)
                .first::<String>(&mut connection)
                .unwrap(),
            "json"
        );
    }

    #[test]
    fn an_existing_note_becomes_a_snippet_when_todo_lists_arrive() {
        // Le vrai chemin de mise à jour : une base déjà peuplée, pas une base
        // neuve. `ADD COLUMN kind` n'a de valeur pour ces lignes que par son
        // `DEFAULT`, et sans lui SQLite refuserait la colonne `NOT NULL`.
        let mut connection = legacy_database(
            &[
                LEGACY_SCHEMA,
                LEGACY_FOLD_TAG_CASE,
                "INSERT INTO spaces (id, name) VALUES ('s-1', 'Perso');
                     INSERT INTO notes VALUES
                       ('n-1', 's-1', 'A', 'sql', 'select 1', '', 0, '2026-07-25T09:00:00.000Z',
                        '2026-07-25T09:00:00.000Z', 'permanent', NULL);",
            ],
            2,
        );

        run(&mut connection).unwrap();

        assert!(!connection.has_pending_migration(MIGRATIONS).unwrap());
        assert_eq!(
            schema::notes::table
                .select(schema::notes::kind)
                .first::<String>(&mut connection)
                .unwrap(),
            "snippet"
        );
        // Le contenu n'est pas réécrit : la migration ajoute, elle ne touche à rien.
        assert_eq!(
            schema::notes::table
                .select(schema::notes::content)
                .first::<String>(&mut connection)
                .unwrap(),
            "select 1"
        );
        assert_eq!(
            count(&mut connection, "SELECT COUNT(*) AS count FROM note_items"),
            0
        );
    }

    #[test]
    fn adopting_a_legacy_history_clears_the_pragma_it_replaces() {
        let mut connection = legacy_database(&[LEGACY_SCHEMA], 1);

        run(&mut connection).unwrap();

        // Two sources of truth on the schema state would drift apart; the
        // migrations table is now the only one.
        assert_eq!(user_version(&mut connection), 0);
    }

    #[test]
    fn a_migration_this_binary_does_not_know_is_refused() {
        let mut connection = open_in_memory().unwrap();
        diesel::sql_query(
            "INSERT INTO __diesel_schema_migrations (version) VALUES ('2099-01-01-000000')",
        )
        .execute(&mut connection)
        .unwrap();

        let error = run(&mut connection).unwrap_err();

        // Reading a newer schema with older code would silently write rows the
        // newer version cannot make sense of.
        assert!(matches!(error, StorageError::SchemaTooRecent(_)));
    }
}
