//! Commandes « Espaces » : les classeurs dans lesquels les notes sont rangées.
//!
//! `notes.space_id` porte un `ON DELETE CASCADE`, donc un `DELETE` nu
//! emporterait les notes. [`delete_space`] exige un espace **refuge** et y
//! transfère les notes dans la même transaction — il n'existe volontairement
//! aucune variante sans refuge.
//!
//! À décider : `list_spaces` renvoie une liste vide au premier lancement, et
//! l'application refuse alors de créer une note. Créer un espace initial est un
//! choix produit, pas une contrainte technique.

use tauri::State;

use super::error::AppError;
use super::lock;
use crate::domain::space::{self, Space, SpaceDraft};
use crate::storage::{self, Db};

#[tauri::command]
pub fn list_spaces(db: State<'_, Db>) -> Result<Vec<Space>, AppError> {
    let connection = lock(&db)?;

    Ok(storage::spaces::list(&connection)?)
}

/// Le front sélectionne aussitôt l'espace à partir de la valeur renvoyée.
#[tauri::command]
pub fn create_space(draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, AppError> {
    // Nom déjà détouré et non vide : le stockage n'a plus qu'à trancher
    // l'unicité, la seule chose que lui seul peut voir.
    let name = draft.validated_name()?;

    let connection = lock(&db)?;

    Ok(storage::spaces::create(&connection, &name)?)
}

/// Même brouillon qu'à la création, donc même validation.
#[tauri::command]
pub fn rename_space(id: String, draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, AppError> {
    let name = draft.validated_name()?;

    let connection = lock(&db)?;

    Ok(storage::spaces::rename(&connection, &id, &name)?)
}

/// Supprime un espace après avoir transféré ses notes vers `target_space_id`.
///
/// ⚠️ Tauri v2 renomme les arguments en camelCase : le front envoie
/// `targetSpaceId`, pas `target_space_id` (cf. `IpcContract`).
#[tauri::command]
pub fn delete_space(
    id: String,
    target_space_id: String,
    db: State<'_, Db>,
) -> Result<(), AppError> {
    // Un espace son propre refuge verrait ses notes emportées par la cascade
    // juste après le transfert : refusé avant même de verrouiller.
    space::validate_move_target(&id, &target_space_id)?;

    let mut connection = lock(&db)?;

    Ok(storage::spaces::delete(
        &mut connection,
        &id,
        &target_space_id,
    )?)
}
