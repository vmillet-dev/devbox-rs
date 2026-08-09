//! Spaces: the folders where notes are stored.
//!
//! This file holds the commands; [`model`] holds the rules, [`store`] holds the SQL.
//!
//! `notes.space_id` has an `ON DELETE CASCADE`, so a bare `DELETE` would sweep away
//! the notes: [`delete_space`] requires a **refuge** space, and there is
//! deliberately no variant without one.

// A command receives its arguments deserialized from the IPC payload:
// they arrive owned, whether it consumes them or not.
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
    // Trimmed and non-empty here; storage only handles uniqueness.
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

/// Transfers notes to `target_space_id` before deleting.
#[tauri::command]
#[specta::specta]
pub fn delete_space(
    id: String,
    target_space_id: String,
    db: State<'_, Db>,
) -> Result<(), AppError> {
    // A space as its own refuge would see its notes swept away by the
    // cascade right after the transfer.
    model::validate_move_target(&id, &target_space_id)?;

    let mut connection = lock(&db)?;

    Ok(store::delete(&mut connection, &id, &target_space_id)?)
}
