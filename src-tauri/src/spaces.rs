//! L'espace : le classeur dans lequel les notes sont rangées.
//!
//! Ce fichier porte les commandes ; [`model`] les règles, [`store`] le SQL.
//!
//! `notes.space_id` porte un `ON DELETE CASCADE`, donc un `DELETE` nu emporterait
//! les notes : [`delete_space`] exige un espace **refuge**, et il n'existe
//! volontairement aucune variante sans.

// Une commande reçoit ses arguments désérialisés depuis la charge utile IPC :
// ils arrivent possédés, qu'elle les consomme ou non.
#![allow(clippy::needless_pass_by_value)]

pub mod model;
pub mod store;

use tauri::State;

use crate::db::{Db, lock};
use crate::error::AppError;
use model::{Space, SpaceDraft};

#[tauri::command]
#[specta::specta]
pub fn list_spaces(db: State<'_, Db>) -> Result<Vec<Space>, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::list(&mut connection)?)
}

#[tauri::command]
#[specta::specta]
pub fn create_space(draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, AppError> {
    // Détouré et non vide ici ; le stockage ne tranche plus que l'unicité.
    let name = draft.validated_name()?;

    let mut connection = lock(&db)?;

    Ok(store::create(&mut connection, &name)?)
}

#[tauri::command]
#[specta::specta]
pub fn rename_space(id: String, draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, AppError> {
    let name = draft.validated_name()?;

    let mut connection = lock(&db)?;

    Ok(store::rename(&mut connection, &id, &name)?)
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
    model::validate_move_target(&id, &target_space_id)?;

    let mut connection = lock(&db)?;

    Ok(store::delete(&mut connection, &id, &target_space_id)?)
}
