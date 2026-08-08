//! Persistance : SQLite embarqué (Diesel, `libsqlite3-sys` en `bundled`, base
//! dans `app_data_dir()`). Ouverture, configuration et migrations ici ; les
//! lectures et écritures dans `storage::notes` et `storage::spaces`, sous forme
//! de fonctions prenant une `&mut SqliteConnection` — d'où des tests sur base en
//! mémoire, sans lancer Tauri. **Aucune règle métier** : elles sont dans
//! `crate::domain`.
//!
//! ⚠️ **Les migrations sont append-only.** Elles vivent dans `src-tauri/migrations/`,
//! embarquées dans le binaire par [`embed_migrations!`] et suivies par la table
//! `__diesel_schema_migrations` : faire évoluer le modèle = ajouter un dossier
//! `AAAA-MM-JJ-HHMMSS_nom/`, jamais modifier une migration déjà livrée.
//!
//! Le `&mut` est imposé par Diesel, qui prend la connexion en exclusif à chaque
//! requête. Il ne change rien à la concurrence réelle : le mutex de [`Db`] la
//! sérialisait déjà.

pub mod notes;
pub mod schema;
pub mod spaces;

use std::fmt;
use std::path::Path;
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use diesel::connection::SimpleConnection;
use diesel::migration::MigrationSource;
use diesel::prelude::*;
use diesel::sql_types::{Integer, Text};
use diesel::sqlite::Sqlite;
use diesel_migrations::{EmbeddedMigrations, MigrationHarness, embed_migrations};

/// Instant courant en ISO 8601 UTC, ex. `2026-07-25T09:12:00.000Z`. La
/// milliseconde n'est pas décorative : sans elle, deux notes modifiées dans la
/// même seconde seraient impossibles à départager au tri.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Connexion unique partagée via `tauri::State` : `SqliteConnection` n'est pas
/// `Sync`, et deux commandes qui se chevauchent se sérialisent sur ce mutex.
pub type Db = Mutex<SqliteConnection>;

pub const DB_FILE_NAME: &str = "devbox.sqlite3";

const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// Nombre de migrations qu'a connues l'ancien versionnement par
/// `PRAGMA user_version` : sa valeur maximale livrée était 3. Voir
/// [`adopt_legacy_history`] — cette constante ne bouge plus, une migration
/// ajoutée aujourd'hui n'a jamais existé sous l'ancien schéma.
const LEGACY_MIGRATION_COUNT: usize = 3;

/// Les commandes convertissent ces variantes en `AppError` : la variante devient
/// un **code** que le front traduit, et le `Display` ci-dessous n'est plus que
/// le détail technique — c'est pourquoi il peut rester en français.
#[derive(Debug)]
pub enum StorageError {
    /// Jamais un `Ok` silencieux : le front croirait avoir enregistré.
    NoteNotFound(String),
    /// Espace visé inexistant : la note n'aurait nulle part où être rangée.
    SpaceNotFound(String),
    /// Nom déjà pris (comparaison insensible à la casse).
    DuplicateSpaceName(String),
    /// Base portant une migration que ce binaire ne connaît pas : elle a été
    /// écrite par une version plus récente de l'application.
    SchemaTooRecent(String),
    /// Ouverture ou migration impossible — panne d'avant le premier `SELECT`.
    Migration(String),
    Sqlite(diesel::result::Error),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoteNotFound(id) => write!(f, "Note introuvable : {id}"),
            Self::SpaceNotFound(id) => write!(f, "Espace introuvable : {id}"),
            Self::DuplicateSpaceName(name) => {
                write!(f, "Un espace nommé « {name} » existe déjà")
            }
            Self::SchemaTooRecent(version) => write!(
                f,
                "Base de données portant la migration « {version} », inconnue de cette version de DevBox",
            ),
            Self::Migration(detail) => write!(f, "Migration impossible : {detail}"),
            Self::Sqlite(error) => write!(f, "Erreur de stockage : {error}"),
        }
    }
}

impl std::error::Error for StorageError {}

/// Requise par `Connection::transaction`, qui exige de savoir absorber l'erreur
/// de Diesel dans celle de l'appelant.
impl From<diesel::result::Error> for StorageError {
    fn from(error: diesel::result::Error) -> Self {
        Self::Sqlite(error)
    }
}

/// Ouvre la base (en la créant au besoin), la configure, migre.
pub fn open(path: &Path) -> Result<SqliteConnection, StorageError> {
    let mut connection = SqliteConnection::establish(&path.to_string_lossy())
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    configure(&mut connection)?;
    migrate(&mut connection)?;
    Ok(connection)
}

/// Base éphémère, pour les tests.
#[cfg(test)]
pub fn open_in_memory() -> Result<SqliteConnection, StorageError> {
    let mut connection = SqliteConnection::establish(":memory:")
        .map_err(|error| StorageError::Migration(error.to_string()))?;
    configure(&mut connection)?;
    migrate(&mut connection)?;
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

/// Versions des migrations embarquées, dans l'ordre d'application.
fn embedded_versions() -> Result<Vec<String>, StorageError> {
    let mut versions = MigrationSource::<Sqlite>::migrations(&MIGRATIONS)
        .map_err(|error| StorageError::Migration(error.to_string()))?
        .iter()
        .map(|migration| migration.name().version().to_string())
        .collect::<Vec<_>>();
    versions.sort();

    Ok(versions)
}

#[derive(QueryableByName)]
struct UserVersion {
    #[diesel(sql_type = Integer)]
    user_version: i32,
}

/// Fait adopter par Diesel l'historique qu'écrivait l'ancien `PRAGMA user_version`.
///
/// Sans elle, une base déjà installée aurait un `__diesel_schema_migrations` vide
/// et rejouerait la migration initiale sur des tables existantes — échec au
/// lancement. Les `n` premières migrations sont donc marquées comme appliquées
/// sans être exécutées.
///
/// Le pragma est ensuite remis à zéro : deux sources de vérité sur l'état du
/// schéma finiraient par diverger. Un binaire antérieur à Diesel rouvrant cette
/// base tenterait alors de rejouer la migration initiale et échouerait au
/// lancement — bruyamment, plutôt que d'écrire dans un schéma qu'il croit à jour.
fn adopt_legacy_history(
    connection: &mut SqliteConnection,
    embedded: &[String],
) -> Result<(), StorageError> {
    let legacy: i32 = diesel::sql_query("PRAGMA user_version")
        .get_result::<UserVersion>(connection)?
        .user_version;

    // Zéro : base neuve, ou passée par ici lors d'une ouverture précédente.
    if legacy <= 0 {
        return Ok(());
    }

    // Crée `__diesel_schema_migrations` si elle manque — l'insertion suit.
    connection
        .applied_migrations()
        .map_err(|error| StorageError::Migration(error.to_string()))?;

    let adopted = (legacy as usize)
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

fn migrate(connection: &mut SqliteConnection) -> Result<(), StorageError> {
    let embedded = embedded_versions()?;

    adopt_legacy_history(connection, &embedded)?;

    // Refuser franchement vaut mieux que lire de travers et écraser des données :
    // une migration appliquée qu'on ne connaît pas signale une base écrite par
    // une version plus récente.
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
    use super::*;
    use diesel::sql_types::BigInt;

    /// Le SQL de la migration initiale tel qu'il a été livré. Rejoué à la main,
    /// il fabrique une base « héritée » : schéma en place, `user_version` posé,
    /// aucune trace côté Diesel.
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

    /// Base au schéma d'origine, versionnée comme l'ancien code le faisait.
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
        migrate(&mut connection).unwrap();

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

        migrate(&mut connection).unwrap();

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
    fn adopting_a_legacy_history_clears_the_pragma_it_replaces() {
        let mut connection = legacy_database(&[LEGACY_SCHEMA], 1);

        migrate(&mut connection).unwrap();

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

        let error = migrate(&mut connection).unwrap_err();

        // Reading a newer schema with older code would silently write rows the
        // newer version cannot make sense of.
        assert!(matches!(error, StorageError::SchemaTooRecent(_)));
    }

    #[test]
    fn a_fresh_database_is_empty() {
        let mut connection = open_in_memory().unwrap();

        assert!(notes::list(&mut connection).unwrap().is_empty());
        assert!(spaces::list(&mut connection).unwrap().is_empty());
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let mut connection = open_in_memory().unwrap();

        #[derive(QueryableByName)]
        struct ForeignKeys {
            #[diesel(sql_type = Integer)]
            foreign_keys: i32,
        }

        let enabled = diesel::sql_query("PRAGMA foreign_keys")
            .get_result::<ForeignKeys>(&mut connection)
            .unwrap()
            .foreign_keys;

        assert_eq!(enabled, 1);
    }
}
