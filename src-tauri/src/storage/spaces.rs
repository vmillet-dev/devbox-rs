//! Lecture et écriture des espaces.
//!
//! Fonctions ordinaires prenant une `&Connection` : les `#[tauri::command]` de
//! `commands/spaces.rs` ne font que les appeler. Voir `storage/mod.rs`.

use rusqlite::{Connection, Row};
use uuid::Uuid;

use super::StorageError;
use crate::commands::spaces::{Space, SpaceDraft};

fn row_to_space(row: &Row<'_>) -> rusqlite::Result<Space> {
    Ok(Space {
        id: row.get("id")?,
        name: row.get("name")?,
    })
}

/// Tous les espaces, triés par nom.
///
/// Une liste vide est une réponse valide : c'est l'état du premier lancement.
/// Aucun espace « Tous » n'est fabriqué ici — c'est un mode d'affichage du
/// front, pas une donnée ; en créer un ferait ranger des notes dedans.
pub fn list(connection: &Connection) -> Result<Vec<Space>, StorageError> {
    let mut statement =
        connection.prepare("SELECT id, name FROM spaces ORDER BY name COLLATE NOCASE")?;
    let spaces = statement
        .query_map([], row_to_space)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(spaces)
}

/// Vérifie qu'un espace existe. Utilisé par `storage::notes` avant de ranger une
/// note : la contrainte de clé étrangère l'attraperait aussi, mais avec un
/// message SQLite illisible là où le front affiche l'erreur telle quelle.
pub fn exists(connection: &Connection, id: &str) -> Result<bool, StorageError> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM spaces WHERE id = ?1",
        [id],
        |row| row.get(0),
    )?;

    Ok(count > 0)
}

/// Crée un espace et renvoie sa version persistée : le front sélectionne
/// aussitôt l'espace à partir de cette valeur de retour.
pub fn create(connection: &Connection, draft: &SpaceDraft) -> Result<Space, StorageError> {
    let space = Space {
        id: Uuid::new_v4().to_string(),
        name: draft.name.clone(),
    };

    // Le doublon est détecté ici plutôt que laissé à l'index unique, pour
    // remonter au front un message qu'il peut afficher tel quel.
    let taken: i64 = connection.query_row(
        "SELECT COUNT(*) FROM spaces WHERE name = ?1 COLLATE NOCASE",
        [&space.name],
        |row| row.get(0),
    )?;
    if taken > 0 {
        return Err(StorageError::DuplicateSpaceName(space.name));
    }

    connection.execute(
        "INSERT INTO spaces (id, name) VALUES (?1, ?2)",
        (&space.id, &space.name),
    )?;

    Ok(space)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::open_in_memory;

    fn draft(name: &str) -> SpaceDraft {
        SpaceDraft {
            name: name.to_string(),
        }
    }

    #[test]
    fn a_created_space_is_listed_back() {
        let connection = open_in_memory().unwrap();

        let created = create(&connection, &draft("Perso")).unwrap();
        let listed = list(&connection).unwrap();

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].name, "Perso");
    }

    #[test]
    fn each_space_gets_its_own_identifier() {
        let connection = open_in_memory().unwrap();

        let first = create(&connection, &draft("Perso")).unwrap();
        let second = create(&connection, &draft("Boulot")).unwrap();

        assert_ne!(first.id, second.id);
    }

    #[test]
    fn spaces_are_listed_in_name_order() {
        let connection = open_in_memory().unwrap();

        create(&connection, &draft("Veille")).unwrap();
        create(&connection, &draft("Boulot")).unwrap();
        create(&connection, &draft("perso")).unwrap();

        let names: Vec<String> = list(&connection).unwrap().into_iter().map(|s| s.name).collect();

        assert_eq!(names, ["Boulot", "perso", "Veille"]);
    }

    #[test]
    fn a_duplicate_name_is_refused_regardless_of_case() {
        let connection = open_in_memory().unwrap();
        create(&connection, &draft("Perso")).unwrap();

        let error = create(&connection, &draft("PERSO")).unwrap_err();

        assert!(matches!(error, StorageError::DuplicateSpaceName(_)));
        assert_eq!(list(&connection).unwrap().len(), 1);
    }

    #[test]
    fn exists_distinguishes_known_from_unknown_identifiers() {
        let connection = open_in_memory().unwrap();
        let space = create(&connection, &draft("Perso")).unwrap();

        assert!(exists(&connection, &space.id).unwrap());
        assert!(!exists(&connection, "inconnu").unwrap());
    }
}
