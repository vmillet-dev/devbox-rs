//! Lecture et écriture des espaces.
//!
//! Fonctions ordinaires prenant une `&mut SqliteConnection` : les
//! `#[tauri::command]` de `commands/spaces.rs` ne font que les appeler. Voir
//! `storage/mod.rs`.
//!
//! Pas de structure de ligne ici, contrairement aux notes : `Space` a deux
//! champs et traverse tel quel. Une `SpaceRow` identique au type du domaine
//! serait un mappeur d'identité, écrit pour la symétrie et pour rien d'autre.

use diesel::dsl::sql;
use diesel::prelude::*;
use diesel::sql_types::{Bool, Text};

use super::StorageError;
use super::schema::{notes, spaces};
use crate::domain::space::Space;
use uuid::Uuid;

/// Tous les espaces, triés par nom. Une liste vide est valide : c'est l'état du
/// premier lancement. Aucun espace « Tous » n'est fabriqué ici.
pub fn list(connection: &mut SqliteConnection) -> Result<Vec<Space>, StorageError> {
    let rows = spaces::table
        .select((spaces::id, spaces::name))
        // Fragment brut : Diesel ne modélise pas les collations, et trier en
        // BINARY rangerait « perso » après « Veille ».
        .order(sql::<Text>("name COLLATE NOCASE"))
        .load::<(String, String)>(connection)?;

    Ok(rows
        .into_iter()
        .map(|(id, name)| Space { id, name })
        .collect())
}

/// Vérifié avant de ranger une note : la clé étrangère l'attraperait aussi, mais
/// avec un message SQLite illisible là où le front affiche l'erreur.
pub fn exists(connection: &mut SqliteConnection, id: &str) -> Result<bool, StorageError> {
    let found = spaces::table
        .find(id)
        .select(spaces::id)
        .first::<String>(connection)
        .optional()?;

    Ok(found.is_some())
}

/// Doublon détecté ici plutôt que laissé à l'index unique, pour remonter au
/// front un code qu'il sait traduire.
///
/// `except_id` exclut l'espace renommé : sans lui, corriger la casse d'un nom
/// (« perso » → « Perso ») se ferait refuser comme un doublon de lui-même, la
/// comparaison étant en `COLLATE NOCASE`.
fn ensure_unique_name(
    connection: &mut SqliteConnection,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), StorageError> {
    // `spaces.name` n'est pas déclarée `NOCASE` — seul l'index unique l'est —
    // donc la collation doit être posée sur la comparaison, faute de quoi elle
    // se ferait en BINARY et laisserait passer « PERSO » à côté de « Perso ».
    let mut query = spaces::table
        .filter(
            sql::<Bool>("name = ")
                .bind::<Text, _>(name.to_string())
                .sql(" COLLATE NOCASE"),
        )
        .into_boxed();

    if let Some(id) = except_id {
        query = query.filter(spaces::id.ne(id.to_string()));
    }

    if query.count().get_result::<i64>(connection)? > 0 {
        return Err(StorageError::DuplicateSpaceName(name.to_string()));
    }

    Ok(())
}

/// Renvoie la version persistée : le front sélectionne aussitôt l'espace à
/// partir de cette valeur. `name` est attendu **déjà validé** (détouré, non
/// vide) — cette couche ne tranche que l'unicité.
pub fn create(connection: &mut SqliteConnection, name: &str) -> Result<Space, StorageError> {
    ensure_unique_name(connection, name, None)?;

    let space = Space {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
    };

    diesel::insert_into(spaces::table)
        .values((spaces::id.eq(&space.id), spaces::name.eq(&space.name)))
        .execute(connection)?;

    Ok(space)
}

/// Renomme et renvoie la version persistée. `name` est attendu **déjà validé**.
pub fn rename(
    connection: &mut SqliteConnection,
    id: &str,
    name: &str,
) -> Result<Space, StorageError> {
    if !exists(connection, id)? {
        return Err(StorageError::SpaceNotFound(id.to_string()));
    }

    ensure_unique_name(connection, name, Some(id))?;

    diesel::update(spaces::table.find(id))
        .set(spaces::name.eq(name))
        .execute(connection)?;

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
pub fn delete(
    connection: &mut SqliteConnection,
    id: &str,
    target_id: &str,
) -> Result<(), StorageError> {
    connection.transaction(|connection| {
        if !exists(connection, id)? {
            return Err(StorageError::SpaceNotFound(id.to_string()));
        }
        if !exists(connection, target_id)? {
            return Err(StorageError::SpaceNotFound(target_id.to_string()));
        }

        diesel::update(notes::table.filter(notes::space_id.eq(id)))
            .set(notes::space_id.eq(target_id))
            .execute(connection)?;
        diesel::delete(spaces::table.find(id)).execute(connection)?;

        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::open_in_memory;

    const T0: &str = "2026-07-25T09:00:00.000Z";

    /// Note posée directement en base : ces tests portent sur les espaces, et
    /// passer par `notes::create` y ferait entrer ses propres règles.
    fn note_in(connection: &mut SqliteConnection, space_id: &str) {
        diesel::insert_into(notes::table)
            .values((
                notes::id.eq("n-1"),
                notes::space_id.eq(space_id),
                notes::title.eq("A"),
                notes::language.eq("txt"),
                notes::content.eq(""),
                notes::source.eq(""),
                notes::pinned.eq(false),
                notes::created_at.eq(T0),
                notes::updated_at.eq(T0),
                notes::lifecycle_kind.eq("permanent"),
            ))
            .execute(connection)
            .unwrap();
    }

    fn names(connection: &mut SqliteConnection) -> Vec<String> {
        list(connection)
            .unwrap()
            .into_iter()
            .map(|space| space.name)
            .collect()
    }

    #[test]
    fn a_created_space_is_listed_back() {
        let mut connection = open_in_memory().unwrap();

        let created = create(&mut connection, "Perso").unwrap();
        let listed = list(&mut connection).unwrap();

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].name, "Perso");
    }

    #[test]
    fn each_space_gets_its_own_identifier() {
        let mut connection = open_in_memory().unwrap();

        let first = create(&mut connection, "Perso").unwrap();
        let second = create(&mut connection, "Boulot").unwrap();

        assert_ne!(first.id, second.id);
    }

    #[test]
    fn spaces_are_listed_in_name_order() {
        let mut connection = open_in_memory().unwrap();

        create(&mut connection, "Veille").unwrap();
        create(&mut connection, "Boulot").unwrap();
        create(&mut connection, "perso").unwrap();

        // Case-insensitive: a BINARY sort would file "perso" after "Veille".
        assert_eq!(names(&mut connection), ["Boulot", "perso", "Veille"]);
    }

    #[test]
    fn a_duplicate_name_is_refused_regardless_of_case() {
        let mut connection = open_in_memory().unwrap();
        create(&mut connection, "Perso").unwrap();

        let error = create(&mut connection, "PERSO").unwrap_err();

        assert!(matches!(error, StorageError::DuplicateSpaceName(_)));
        assert_eq!(list(&mut connection).unwrap().len(), 1);
    }

    #[test]
    fn exists_distinguishes_known_from_unknown_identifiers() {
        let mut connection = open_in_memory().unwrap();
        let space = create(&mut connection, "Perso").unwrap();

        assert!(exists(&mut connection, &space.id).unwrap());
        assert!(!exists(&mut connection, "inconnu").unwrap());
    }

    #[test]
    fn a_renamed_space_keeps_its_identifier() {
        let mut connection = open_in_memory().unwrap();
        let space = create(&mut connection, "Perso").unwrap();

        let renamed = rename(&mut connection, &space.id, "Personnel").unwrap();

        // The id is what the notes point at: changing it would orphan them.
        assert_eq!(renamed.id, space.id);
        assert_eq!(renamed.name, "Personnel");
        assert_eq!(list(&mut connection).unwrap()[0].name, "Personnel");
    }

    #[test]
    fn a_space_can_be_renamed_to_a_different_case_of_its_own_name() {
        let mut connection = open_in_memory().unwrap();
        let space = create(&mut connection, "perso").unwrap();

        // The uniqueness check is COLLATE NOCASE: without excluding the row
        // being renamed, it would see the space as a duplicate of itself.
        let renamed = rename(&mut connection, &space.id, "Perso").unwrap();

        assert_eq!(renamed.name, "Perso");
    }

    #[test]
    fn renaming_onto_another_space_name_is_refused() {
        let mut connection = open_in_memory().unwrap();
        create(&mut connection, "Boulot").unwrap();
        let space = create(&mut connection, "Perso").unwrap();

        let error = rename(&mut connection, &space.id, "BOULOT").unwrap_err();

        assert!(matches!(error, StorageError::DuplicateSpaceName(_)));
        assert_eq!(list(&mut connection).unwrap()[1].name, "Perso");
    }

    #[test]
    fn renaming_an_unknown_space_reports_an_error() {
        let mut connection = open_in_memory().unwrap();

        let error = rename(&mut connection, "inconnu", "Perso").unwrap_err();

        assert!(matches!(error, StorageError::SpaceNotFound(_)));
    }

    #[test]
    fn deleting_a_space_moves_its_notes_to_the_target() {
        let mut connection = open_in_memory().unwrap();
        let doomed = create(&mut connection, "Perso").unwrap();
        let refuge = create(&mut connection, "Boulot").unwrap();
        note_in(&mut connection, &doomed.id);

        delete(&mut connection, &doomed.id, &refuge.id).unwrap();

        // The schema cascades on space deletion; the move must happen first or
        // the note disappears with its space.
        let space_id = notes::table
            .find("n-1")
            .select(notes::space_id)
            .first::<String>(&mut connection)
            .unwrap();
        assert_eq!(space_id, refuge.id);
        assert_eq!(list(&mut connection).unwrap().len(), 1);
    }

    #[test]
    fn moving_notes_out_of_a_deleted_space_does_not_touch_their_timestamps() {
        let mut connection = open_in_memory().unwrap();
        let doomed = create(&mut connection, "Perso").unwrap();
        let refuge = create(&mut connection, "Boulot").unwrap();
        note_in(&mut connection, &doomed.id);

        delete(&mut connection, &doomed.id, &refuge.id).unwrap();

        // The canvas orders on updated_at: refreshing it would float the whole
        // absorbed space to the top as if every note had just been edited.
        let updated_at = notes::table
            .find("n-1")
            .select(notes::updated_at)
            .first::<String>(&mut connection)
            .unwrap();
        assert_eq!(updated_at, T0);
    }

    #[test]
    fn deleting_an_empty_space_leaves_the_others_alone() {
        let mut connection = open_in_memory().unwrap();
        let doomed = create(&mut connection, "Perso").unwrap();
        let refuge = create(&mut connection, "Boulot").unwrap();

        delete(&mut connection, &doomed.id, &refuge.id).unwrap();

        assert_eq!(names(&mut connection), ["Boulot"]);
    }

    #[test]
    fn deleting_an_unknown_space_reports_an_error() {
        let mut connection = open_in_memory().unwrap();
        let refuge = create(&mut connection, "Boulot").unwrap();

        let error = delete(&mut connection, "inconnu", &refuge.id).unwrap_err();

        assert!(matches!(error, StorageError::SpaceNotFound(_)));
    }

    #[test]
    fn deleting_into_an_unknown_space_changes_nothing() {
        let mut connection = open_in_memory().unwrap();
        let doomed = create(&mut connection, "Perso").unwrap();
        note_in(&mut connection, &doomed.id);

        let error = delete(&mut connection, &doomed.id, "inconnu").unwrap_err();

        // Rolling back matters here: a half-applied delete would have taken the
        // notes with it.
        assert!(matches!(error, StorageError::SpaceNotFound(_)));
        assert_eq!(list(&mut connection).unwrap().len(), 1);
        assert_eq!(
            notes::table
                .count()
                .get_result::<i64>(&mut connection)
                .unwrap(),
            1
        );
    }
}
