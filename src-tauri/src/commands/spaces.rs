//! Commandes « Espaces ».
//!
//! `notes.space_id` porte un `ON DELETE CASCADE`, donc un `DELETE` nu emporterait
//! les notes : [`delete_space`] exige un espace **refuge**, et il n'existe
//! volontairement aucune variante sans.

use tauri::State;

use super::Db;
use super::error::AppError;
use super::lock;
use crate::domain::space::{self, Space, SpaceDraft};
use crate::storage;

#[tauri::command]
#[specta::specta]
pub fn list_spaces(db: State<'_, Db>) -> Result<Vec<Space>, AppError> {
    let mut connection = lock(&db)?;

    Ok(storage::spaces::list(&mut connection)?)
}

#[tauri::command]
#[specta::specta]
pub fn create_space(draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, AppError> {
    // Détouré et non vide ici ; le stockage ne tranche plus que l'unicité.
    let name = draft.validated_name()?;

    let mut connection = lock(&db)?;

    Ok(storage::spaces::create(&mut connection, &name)?)
}

#[tauri::command]
#[specta::specta]
pub fn rename_space(id: String, draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, AppError> {
    let name = draft.validated_name()?;

    let mut connection = lock(&db)?;

    Ok(storage::spaces::rename(&mut connection, &id, &name)?)
}

/// Transfère les notes vers `target_space_id` avant de supprimer.
#[tauri::command]
#[specta::specta]
pub fn delete_space(
    id: String,
    target_space_id: String,
    db: State<'_, Db>,
) -> Result<(), AppError> {
    // Un espace son propre refuge verrait ses notes emportées par la cascade
    // juste après le transfert.
    space::validate_move_target(&id, &target_space_id)?;

    let mut connection = lock(&db)?;

    Ok(storage::spaces::delete(
        &mut connection,
        &id,
        &target_space_id,
    )?)
}
