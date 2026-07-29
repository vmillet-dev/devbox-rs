//! Lecture et écriture des espaces.
//!
//! Fonctions ordinaires prenant une `&Connection` : les `#[tauri::command]` de
//! `commands/spaces.rs` ne font que les appeler. Voir `storage/mod.rs`.

use rusqlite::{Connection, Row};
use uuid::Uuid;

use super::StorageError;
use crate::domain::space::Space;

fn row_to_space(row: &Row<'_>) -> rusqlite::Result<Space> {
    Ok(Space {
        id: row.get("id")?,
        name: row.get("name")?,
    })
}

/// Tous les espaces, triés par nom. Une liste vide est valide : c'est l'état du
/// premier lancement. Aucun espace « Tous » n'est fabriqué ici.
pub fn list(connection: &Connection) -> Result<Vec<Space>, StorageError> {
    let mut statement =
        connection.prepare("SELECT id, name FROM spaces ORDER BY name COLLATE NOCASE")?;
    let spaces = statement
        .query_map([], row_to_space)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(spaces)
}

/// Vérifié avant de ranger une note : la clé étrangère l'attraperait aussi, mais
/// avec un message SQLite illisible là où le front affiche l'erreur.
pub fn exists(connection: &Connection, id: &str) -> Result<bool, StorageError> {
    let count: i64 =
        connection.query_row("SELECT COUNT(*) FROM spaces WHERE id = ?1", [id], |row| {
            row.get(0)
        })?;

    Ok(count > 0)
}

/// Doublon détecté ici plutôt que laissé à l'index unique, pour remonter au
/// front un code qu'il sait traduire.
///
/// `except_id` exclut l'espace renommé : sans lui, corriger la casse d'un nom
/// (« perso » → « Perso ») se ferait refuser comme un doublon de lui-même, la
/// comparaison étant en `COLLATE NOCASE`.
fn ensure_unique_name(
    connection: &Connection,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), StorageError> {
    let taken: i64 = match except_id {
        Some(id) => connection.query_row(
            "SELECT COUNT(*) FROM spaces WHERE name = ?1 COLLATE NOCASE AND id <> ?2",
            (name, id),
            |row| row.get(0),
        ),
        None => connection.query_row(
            "SELECT COUNT(*) FROM spaces WHERE name = ?1 COLLATE NOCASE",
            [name],
            |row| row.get(0),
        ),
    }?;

    if taken > 0 {
        return Err(StorageError::DuplicateSpaceName(name.to_string()));
    }

    Ok(())
}

/// Renvoie la version persistée : le front sélectionne aussitôt l'espace à
/// partir de cette valeur. `name` est attendu **déjà validé** (détouré, non
/// vide) — cette couche ne tranche que l'unicité.
pub fn create(connection: &Connection, name: &str) -> Result<Space, StorageError> {
    ensure_unique_name(connection, name, None)?;

    let space = Space {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
    };

    connection.execute(
        "INSERT INTO spaces (id, name) VALUES (?1, ?2)",
        (&space.id, &space.name),
    )?;

    Ok(space)
}

/// Renomme et renvoie la version persistée. `name` est attendu **déjà validé**.
pub fn rename(connection: &Connection, id: &str, name: &str) -> Result<Space, StorageError> {
    if !exists(connection, id)? {
        return Err(StorageError::SpaceNotFound(id.to_string()));
    }

    ensure_unique_name(connection, name, Some(id))?;

    connection.execute("UPDATE spaces SET name = ?2 WHERE id = ?1", (id, name))?;

    Ok(Space {
        id: id.to_string(),
        name: name.to_string(),
    })
}

/// Supprime un espace après avoir déplacé ses notes vers `target_id`.
///
/// ⚠️ Même transaction et **cet ordre** : `notes.space_id` porte un
/// `ON DELETE CASCADE`, donc supprimer d'abord — ou échouer entre les deux —
/// emporterait les notes au lieu de les déplacer.
///
/// `updated_at` n'est pas rafraîchi : le contenu n'a pas changé, et le toucher
/// ferait remonter tout l'espace absorbé en tête du canevas, qui trie dessus.
///
/// `id == target_id` est refusé en amont par `space::validate_move_target`.
pub fn delete(connection: &mut Connection, id: &str, target_id: &str) -> Result<(), StorageError> {
    let transaction = connection.transaction()?;

    if !exists(&transaction, id)? {
        return Err(StorageError::SpaceNotFound(id.to_string()));
    }
    if !exists(&transaction, target_id)? {
        return Err(StorageError::SpaceNotFound(target_id.to_string()));
    }

    transaction.execute(
        "UPDATE notes SET space_id = ?2 WHERE space_id = ?1",
        (id, target_id),
    )?;
    transaction.execute("DELETE FROM spaces WHERE id = ?1", [id])?;

    transaction.commit()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::open_in_memory;

    #[test]
    fn a_created_space_is_listed_back() {
        let connection = open_in_memory().unwrap();

        let created = create(&connection, "Perso").unwrap();
        let listed = list(&connection).unwrap();

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].name, "Perso");
    }

    #[test]
    fn each_space_gets_its_own_identifier() {
        let connection = open_in_memory().unwrap();

        let first = create(&connection, "Perso").unwrap();
        let second = create(&connection, "Boulot").unwrap();

        assert_ne!(first.id, second.id);
    }

    #[test]
    fn spaces_are_listed_in_name_order() {
        let connection = open_in_memory().unwrap();

        create(&connection, "Veille").unwrap();
        create(&connection, "Boulot").unwrap();
        create(&connection, "perso").unwrap();

        let names: Vec<String> = list(&connection)
            .unwrap()
            .into_iter()
            .map(|s| s.name)
            .collect();

        assert_eq!(names, ["Boulot", "perso", "Veille"]);
    }

    #[test]
    fn a_duplicate_name_is_refused_regardless_of_case() {
        let connection = open_in_memory().unwrap();
        create(&connection, "Perso").unwrap();

        let error = create(&connection, "PERSO").unwrap_err();

        assert!(matches!(error, StorageError::DuplicateSpaceName(_)));
        assert_eq!(list(&connection).unwrap().len(), 1);
    }

    #[test]
    fn exists_distinguishes_known_from_unknown_identifiers() {
        let connection = open_in_memory().unwrap();
        let space = create(&connection, "Perso").unwrap();

        assert!(exists(&connection, &space.id).unwrap());
        assert!(!exists(&connection, "inconnu").unwrap());
    }

    #[test]
    fn a_renamed_space_keeps_its_identifier() {
        let connection = open_in_memory().unwrap();
        let space = create(&connection, "Perso").unwrap();

        let renamed = rename(&connection, &space.id, "Personnel").unwrap();

        // The id is what the notes point at: changing it would orphan them.
        assert_eq!(renamed.id, space.id);
        assert_eq!(renamed.name, "Personnel");
        assert_eq!(list(&connection).unwrap()[0].name, "Personnel");
    }

    #[test]
    fn a_space_can_be_renamed_to_a_different_case_of_its_own_name() {
        let connection = open_in_memory().unwrap();
        let space = create(&connection, "perso").unwrap();

        // The uniqueness check is COLLATE NOCASE: without excluding the row
        // being renamed, it would see the space as a duplicate of itself.
        let renamed = rename(&connection, &space.id, "Perso").unwrap();

        assert_eq!(renamed.name, "Perso");
    }

    #[test]
    fn renaming_onto_another_space_name_is_refused() {
        let connection = open_in_memory().unwrap();
        create(&connection, "Boulot").unwrap();
        let space = create(&connection, "Perso").unwrap();

        let error = rename(&connection, &space.id, "BOULOT").unwrap_err();

        assert!(matches!(error, StorageError::DuplicateSpaceName(_)));
        assert_eq!(list(&connection).unwrap()[1].name, "Perso");
    }

    #[test]
    fn renaming_an_unknown_space_reports_an_error() {
        let connection = open_in_memory().unwrap();

        let error = rename(&connection, "inconnu", "Perso").unwrap_err();

        assert!(matches!(error, StorageError::SpaceNotFound(_)));
    }

    #[test]
    fn deleting_a_space_moves_its_notes_to_the_target() {
        let mut connection = open_in_memory().unwrap();
        let doomed = create(&connection, "Perso").unwrap();
        let refuge = create(&connection, "Boulot").unwrap();
        connection
            .execute(
                "INSERT INTO notes VALUES ('n-1', ?1, 'A', 'txt', '', '', 0, \
                 '2026-07-25T09:00:00.000Z', '2026-07-25T09:00:00.000Z', 'permanent', NULL)",
                [&doomed.id],
            )
            .unwrap();

        delete(&mut connection, &doomed.id, &refuge.id).unwrap();

        // The schema cascades on space deletion; the move must happen first or
        // the note disappears with its space.
        let space_id: String = connection
            .query_row("SELECT space_id FROM notes WHERE id = 'n-1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(space_id, refuge.id);
        assert_eq!(list(&connection).unwrap().len(), 1);
    }

    #[test]
    fn moving_notes_out_of_a_deleted_space_does_not_touch_their_timestamps() {
        let mut connection = open_in_memory().unwrap();
        let doomed = create(&connection, "Perso").unwrap();
        let refuge = create(&connection, "Boulot").unwrap();
        connection
            .execute(
                "INSERT INTO notes VALUES ('n-1', ?1, 'A', 'txt', '', '', 0, \
                 '2026-07-25T09:00:00.000Z', '2026-07-25T09:00:00.000Z', 'permanent', NULL)",
                [&doomed.id],
            )
            .unwrap();

        delete(&mut connection, &doomed.id, &refuge.id).unwrap();

        // The canvas orders on updated_at: refreshing it would float the whole
        // absorbed space to the top as if every note had just been edited.
        let updated_at: String = connection
            .query_row("SELECT updated_at FROM notes WHERE id = 'n-1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(updated_at, "2026-07-25T09:00:00.000Z");
    }

    #[test]
    fn deleting_an_empty_space_leaves_the_others_alone() {
        let mut connection = open_in_memory().unwrap();
        let doomed = create(&connection, "Perso").unwrap();
        let refuge = create(&connection, "Boulot").unwrap();

        delete(&mut connection, &doomed.id, &refuge.id).unwrap();

        let names: Vec<String> = list(&connection)
            .unwrap()
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, ["Boulot"]);
    }

    #[test]
    fn deleting_an_unknown_space_reports_an_error() {
        let mut connection = open_in_memory().unwrap();
        let refuge = create(&connection, "Boulot").unwrap();

        let error = delete(&mut connection, "inconnu", &refuge.id).unwrap_err();

        assert!(matches!(error, StorageError::SpaceNotFound(_)));
    }

    #[test]
    fn deleting_into_an_unknown_space_changes_nothing() {
        let mut connection = open_in_memory().unwrap();
        let doomed = create(&connection, "Perso").unwrap();
        connection
            .execute(
                "INSERT INTO notes VALUES ('n-1', ?1, 'A', 'txt', '', '', 0, \
                 '2026-07-25T09:00:00.000Z', '2026-07-25T09:00:00.000Z', 'permanent', NULL)",
                [&doomed.id],
            )
            .unwrap();

        let error = delete(&mut connection, &doomed.id, "inconnu").unwrap_err();

        // Rolling back matters here: a half-applied delete would have taken the
        // notes with it.
        assert!(matches!(error, StorageError::SpaceNotFound(_)));
        assert_eq!(list(&connection).unwrap().len(), 1);
        let remaining: i64 = connection
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 1);
    }
}
