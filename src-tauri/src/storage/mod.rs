//! Persistance : SQLite embarqué (`rusqlite`, feature `bundled`, base dans
//! `app_data_dir()`). Ouverture, configuration et migrations ici ; les lectures
//! et écritures dans `storage::notes` et `storage::spaces`, sous forme de
//! fonctions prenant une `&Connection` — d'où des tests sur base en mémoire,
//! sans lancer Tauri. **Aucune règle métier** : elles sont dans `crate::domain`.
//!
//! ⚠️ **Les migrations sont append-only.** Le schéma est versionné par
//! `PRAGMA user_version` : faire évoluer le modèle = ajouter un `MIGRATION_N` et
//! une branche dans [`migrate`], jamais modifier une migration déjà livrée.

pub mod notes;
pub mod spaces;

use std::fmt;
use std::path::Path;
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use rusqlite::Connection;

/// Instant courant en ISO 8601 UTC, ex. `2026-07-25T09:12:00.000Z`. La
/// milliseconde n'est pas décorative : sans elle, deux notes modifiées dans la
/// même seconde seraient impossibles à départager au tri.
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Connexion unique partagée via `tauri::State` : `Connection` n'est pas `Sync`,
/// et deux commandes qui se chevauchent se sérialisent sur ce mutex.
pub type Db = Mutex<Connection>;

pub const DB_FILE_NAME: &str = "devbox.sqlite3";

/// Version de schéma attendue par ce binaire.
const SCHEMA_VERSION: i32 = 3;

/// Schéma initial. Deux choix rendent le filtrage requêtable : `lifecycle`
/// éclaté en deux colonnes plutôt qu'en JSON, et les tags dans leur propre table
/// plutôt qu'en colonne sérialisée.
const MIGRATION_1: &str = r"
BEGIN;

CREATE TABLE spaces (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- `spaces::create` vérifie l'unicité pour produire une erreur lisible, cet index
-- la garantit même si une écriture passait à côté. NOCASE ne replie que l'ASCII.
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
    -- Garantit que la lecture peut reconstruire l'enum sans cas ambigu.
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

/// Replie la casse des tags **entre** notes, là où `rules::normalize_tags` ne la
/// repliait qu'au sein d'une note : `Urgent` et `urgent` produisaient deux
/// facettes dans le rail, dont `tag IN (…)` n'en retrouvait qu'une.
///
/// La collation d'une colonne ne s'altère pas, d'où la table recréée ;
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

/// Index sur le langage, devenu une facette de filtrage. Sans lui,
/// `language IN (…)` et le `SELECT DISTINCT` du rail balaient tout.
///
/// Pas de `CHECK` sur la colonne : la liste des langages vit dans le domaine et
/// bouge d'une version à l'autre — la figer imposerait une migration par ajout.
const MIGRATION_3: &str = r"
BEGIN;

CREATE INDEX notes_language ON notes (language);

PRAGMA user_version = 3;

COMMIT;
";

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
    /// Base écrite par une version plus récente de l'application.
    SchemaTooRecent(i32),
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

/// Ouvre la base (en la créant au besoin), la configure, migre.
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
    // ⚠️ `foreign_keys` se règle **par connexion** et est désactivé par défaut :
    // sans lui les `ON DELETE CASCADE` sont inertes et les tags d'une note
    // supprimée resteraient orphelins. WAL : un lecteur ne bloque plus un écrivain.
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )?;
    Ok(())
}

fn migrate(connection: &Connection) -> Result<(), StorageError> {
    let version: i32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    // Refuser franchement vaut mieux que lire de travers et écraser des données.
    if version > SCHEMA_VERSION {
        return Err(StorageError::SchemaTooRecent(version));
    }

    // Une base neuve les traverse toutes, une base existante reprend à la sienne.
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
