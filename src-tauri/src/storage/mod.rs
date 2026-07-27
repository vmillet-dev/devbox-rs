//! Couche de persistance : SQLite embarqué via `rusqlite`.
//!
//! Le fichier de base vit dans `app_data_dir()` (voir `lib.rs`), la feature
//! `bundled` de `rusqlite` compile SQLite depuis les sources et le lie en
//! statique : rien à installer ni à distribuer à côté de l'exécutable.
//!
//! # Organisation
//!
//! Ce module ne contient que l'ouverture, la configuration et les migrations.
//! Les lectures et écritures sont dans `storage::notes` et `storage::spaces`,
//! sous forme de fonctions ordinaires prenant une `&Connection`. Les
//! `#[tauri::command]` de `commands/` ne sont que des adaptateurs par-dessus :
//! c'est ce qui permet de tester la persistance sur une base en mémoire, sans
//! lancer Tauri.
//!
//! Cette couche ne porte **aucune règle métier** : elle lit et écrit le modèle
//! défini dans `crate::domain`, dont elle dépend, et qui décide de tout le reste.
//!
//! # Concurrence
//!
//! Une `Connection` rusqlite n'est pas `Sync`. L'unique connexion est donc
//! partagée via `tauri::State<Db>` (`Db = Mutex<Connection>`), enregistrée avec
//! `.manage(...)` dans `lib.rs` — jamais par une variable globale. Deux commandes
//! qui se chevauchent se sérialisent sur ce mutex.
//!
//! # Migrations
//!
//! Le schéma est versionné par `PRAGMA user_version`. Faire évoluer le modèle =
//! ajouter une constante `MIGRATION_N` et une branche dans [`migrate`] ; ne
//! jamais modifier une migration déjà livrée, elle a déjà tourné chez
//! l'utilisateur. Chaque migration est atomique (DDL transactionnel).

pub mod notes;
pub mod spaces;

use std::fmt;
use std::path::Path;
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use rusqlite::Connection;

/// Horodatage courant dans le format attendu de l'autre côté du pont : ISO 8601
/// / RFC 3339 UTC, ex. `2026-07-25T09:12:00.000Z`.
///
/// La milliseconde n'est pas décorative : deux notes modifiées dans la même
/// seconde deviendraient impossibles à départager par le tri de [`notes::list`].
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// État partagé enregistré dans Tauri. Voir la section « Concurrence ».
pub type Db = Mutex<Connection>;

/// Nom du fichier de base, créé dans le répertoire de données de l'application.
pub const DB_FILE_NAME: &str = "devbox.sqlite3";

/// Version de schéma attendue par ce binaire.
const SCHEMA_VERSION: i32 = 3;

/// Schéma initial.
///
/// Deux choix structurants, qui ont permis au filtrage de descendre côté Rust
/// sans re-migration (cf. `storage::notes::query`) :
/// - `lifecycle` est éclaté en deux colonnes plutôt que stocké en JSON, sinon
///   « ce qui expire avant telle date » ne serait pas requêtable ;
/// - les tags sont dans leur propre table plutôt qu'en colonne sérialisée, sinon
///   le filtre par tag imposerait de relire tout le corpus.
const MIGRATION_1: &str = r"
BEGIN;

CREATE TABLE spaces (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- L'unicité des noms est tranchée ici et nulle part ailleurs : `spaces::create`
-- la vérifie pour produire une erreur lisible, cet index la garantit même si
-- une écriture passait à côté. NOCASE ne replie que l'ASCII.
CREATE UNIQUE INDEX spaces_name_unique ON spaces (name COLLATE NOCASE);

CREATE TABLE notes (
    id                   TEXT PRIMARY KEY,
    space_id             TEXT NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    title                TEXT NOT NULL,
    language             TEXT NOT NULL,
    content              TEXT NOT NULL,
    source               TEXT NOT NULL,
    pinned               INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    lifecycle_kind       TEXT NOT NULL CHECK (lifecycle_kind IN ('permanent', 'expires')),
    lifecycle_expires_at TEXT,
    -- Une note « expires » a forcément une date, une note permanente n'en a
    -- jamais : la lecture peut donc reconstruire l'enum sans cas ambigu.
    CHECK ((lifecycle_kind = 'expires') = (lifecycle_expires_at IS NOT NULL))
);

CREATE INDEX notes_space_id ON notes (space_id);
CREATE INDEX notes_updated_at ON notes (updated_at DESC);

CREATE TABLE note_tags (
    note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
);

CREATE INDEX note_tags_tag ON note_tags (tag);

PRAGMA user_version = 1;

COMMIT;
";

/// Replie la casse des tags au niveau du stockage.
///
/// `normalize_tags` dédoublonnait déjà sans tenir compte de la casse, mais
/// **au sein d'une seule note** : sans collation, `Urgent` et `urgent` portés
/// par deux notes différentes produisaient deux facettes dans le rail, dont
/// `tag IN (…)` — en collation BINARY — n'en retrouvait qu'une, alors que la
/// recherche texte, elle, les confondait. Trois comportements pour un concept.
///
/// La collation d'une colonne ne s'altère pas : la table est recréée.
/// `INSERT OR IGNORE` absorbe les doublons que la nouvelle clé primaire fusionne.
const MIGRATION_2: &str = r"
BEGIN;

CREATE TABLE note_tags_v2 (
    note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag     TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (note_id, tag)
);

INSERT OR IGNORE INTO note_tags_v2 (note_id, tag) SELECT note_id, tag FROM note_tags;

DROP TABLE note_tags;
ALTER TABLE note_tags_v2 RENAME TO note_tags;

CREATE INDEX note_tags_tag ON note_tags (tag);

PRAGMA user_version = 2;

COMMIT;
";

/// Index sur le langage, devenu une facette de filtrage à part entière (rail
/// « Format »). Sans lui, `language IN (…)` impose un balayage complet, et
/// `SELECT DISTINCT language` — recalculé à chaque requête pour alimenter le
/// rail — aussi.
///
/// Pas de contrainte `CHECK` sur la colonne : la liste des langages reconnus
/// vit dans `domain::language` et bouge d'une version à l'autre. La figer dans
/// le schéma obligerait à une migration pour chaque ajout.
const MIGRATION_3: &str = r"
BEGIN;

CREATE INDEX notes_language ON notes (language);

PRAGMA user_version = 3;

COMMIT;
";

/// Échecs de la couche de persistance.
///
/// Les commandes convertissent ces variantes en `AppError` (voir
/// `commands/error.rs`) : la variante devient un **code** que le front traduit,
/// et le `Display` ci-dessous n'est plus que le détail technique affiché en
/// second plan. C'est pourquoi il peut rester en français.
#[derive(Debug)]
pub enum StorageError {
    /// Note introuvable — jamais un `Ok` silencieux, sinon le front croirait
    /// avoir enregistré.
    NoteNotFound(String),
    /// Espace visé par une note inexistant : la note n'aurait nulle part où être rangée.
    SpaceNotFound(String),
    /// Un espace porte déjà ce nom (comparaison insensible à la casse).
    DuplicateSpaceName(String),
    /// La base a été écrite par une version plus récente de l'application.
    SchemaTooRecent(i32),
    /// Panne de lecture ou d'écriture.
    Sqlite(rusqlite::Error),
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
                "Base de données en version {version}, plus récente que cette version de DevBox (schéma {SCHEMA_VERSION})",
            ),
            Self::Sqlite(error) => write!(f, "Erreur de stockage : {error}"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

/// Ouvre la base au chemin donné (en la créant au besoin), la configure et
/// applique les migrations manquantes.
pub fn open(path: &Path) -> Result<Connection, StorageError> {
    let connection = Connection::open(path)?;
    configure(&connection)?;
    migrate(&connection)?;
    Ok(connection)
}

/// Base éphémère, pour les tests.
#[cfg(test)]
pub fn open_in_memory() -> Result<Connection, StorageError> {
    let connection = Connection::open_in_memory()?;
    configure(&connection)?;
    migrate(&connection)?;
    Ok(connection)
}

fn configure(connection: &Connection) -> Result<(), StorageError> {
    // `foreign_keys` est désactivé par défaut dans SQLite et se règle **par
    // connexion** : sans lui, les `ON DELETE CASCADE` du schéma ne s'appliquent
    // pas et les tags d'une note supprimée resteraient orphelins.
    // WAL : un lecteur ne bloque plus un écrivain (sans effet sur une base en mémoire).
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )?;
    Ok(())
}

fn migrate(connection: &Connection) -> Result<(), StorageError> {
    let version: i32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    // Base écrite par une version plus récente de l'application : ses tables ne
    // sont pas celles que ce binaire sait lire. Refuser franchement vaut mieux
    // que lire de travers et écraser des données.
    if version > SCHEMA_VERSION {
        return Err(StorageError::SchemaTooRecent(version));
    }

    // Chaque migration manquante est appliquée dans l'ordre : une base neuve
    // les traverse toutes, une base existante ne reprend qu'à partir de la sienne.
    if version < 1 {
        connection.execute_batch(MIGRATION_1)?;
    }
    if version < 2 {
        connection.execute_batch(MIGRATION_2)?;
    }
    if version < 3 {
        connection.execute_batch(MIGRATION_3)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_twice_is_idempotent() {
        let directory = std::env::temp_dir().join(format!("devbox-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(DB_FILE_NAME);

        open(&path).unwrap();
        // A second open must find the schema already at the expected version and
        // not attempt to re-create the tables.
        let connection = open(&path).unwrap();

        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_v1_database_upgrades_and_folds_tag_case() {
        let connection = Connection::open_in_memory().unwrap();
        configure(&connection).unwrap();
        connection.execute_batch(MIGRATION_1).unwrap();
        connection
            .execute_batch(
                "INSERT INTO spaces (id, name) VALUES ('s-1', 'Perso');
                 INSERT INTO notes VALUES
                   ('n-1', 's-1', 'A', 'txt', '', '', 0, '2026-07-25T09:00:00.000Z',
                    '2026-07-25T09:00:00.000Z', 'permanent', NULL),
                   ('n-2', 's-1', 'B', 'txt', '', '', 0, '2026-07-25T09:00:00.000Z',
                    '2026-07-25T09:00:00.000Z', 'permanent', NULL);
                 INSERT INTO note_tags VALUES ('n-1', 'Urgent'), ('n-2', 'urgent');",
            )
            .unwrap();

        migrate(&connection).unwrap();

        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        // Both rows survive: the collation folds the facet, it does not drop data.
        let rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM note_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 2);

        // But the rail now sees one tag where it used to see two.
        let facets: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM (SELECT DISTINCT tag FROM note_tags)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(facets, 1);
    }

    #[test]
    fn a_v2_database_gains_the_language_index_without_touching_its_notes() {
        let connection = Connection::open_in_memory().unwrap();
        configure(&connection).unwrap();
        connection.execute_batch(MIGRATION_1).unwrap();
        connection.execute_batch(MIGRATION_2).unwrap();
        connection
            .execute_batch(
                "INSERT INTO spaces (id, name) VALUES ('s-1', 'Perso');
                 INSERT INTO notes VALUES
                   ('n-1', 's-1', 'A', 'json', '', '', 0, '2026-07-25T09:00:00.000Z',
                    '2026-07-25T09:00:00.000Z', 'permanent', NULL);",
            )
            .unwrap();

        migrate(&connection).unwrap();

        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let indexes: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'index' AND name = 'notes_language'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 1);

        // The migration is an index, not a rewrite: the note is untouched.
        let language: String = connection
            .query_row("SELECT language FROM notes WHERE id = 'n-1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(language, "json");
    }

    #[test]
    fn a_fresh_database_is_empty() {
        let connection = open_in_memory().unwrap();

        assert!(notes::list(&connection).unwrap().is_empty());
        assert!(spaces::list(&connection).unwrap().is_empty());
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let connection = open_in_memory().unwrap();

        let enabled: bool = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();

        assert!(enabled);
    }
}
