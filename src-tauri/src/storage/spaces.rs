//! Lecture et écriture des espaces.
//!
//! Pas de structure de ligne ici, contrairement aux notes : `Space` a deux champs
//! et traverse tel quel.

use diesel::dsl::sql;
use diesel::prelude::*;
use diesel::sql_types::{Bool, Text};

use super::StorageError;
use super::schema::{notes, spaces};
use crate::domain::space::Space;
use uuid::Uuid;

/// Une liste vide est valide : c'est l'état du premier lancement. Aucun espace
/// « Tous » n'est fabriqué ici.
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

/// La clé étrangère l'attraperait aussi, mais avec un message SQLite illisible
/// là où le front affiche l'erreur.
pub fn exists(connection: &mut SqliteConnection, id: &str) -> Result<bool, StorageError> {
    let found = spaces::table
        .find(id)
        .select(spaces::id)
        .first::<String>(connection)
        .optional()?;

    Ok(found.is_some())
}

/// Détecté ici plutôt que laissé à l'index unique, pour remonter au front un
/// code qu'il sait traduire.
///
/// `except_id` exclut l'espace renommé : sans lui, corriger la casse d'un nom
/// se ferait refuser comme un doublon de lui-même, la comparaison étant `NOCASE`.
fn ensure_unique_name(
    connection: &mut SqliteConnection,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), StorageError> {
    // ⚠️ `spaces.name` n'est pas déclarée `NOCASE` — seul l'index unique l'est —
    // donc la collation doit être posée sur la comparaison, sans quoi « PERSO »
    // passerait à côté de « Perso ».
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

/// `name` est attendu **déjà validé** : cette couche ne tranche que l'unicité.
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

/// `name` est attendu **déjà validé**.
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
/// `updated_at` n'est pas rafraîchi : le toucher ferait remonter tout l'espace
/// absorbé en tête du canevas, qui trie dessus.
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
