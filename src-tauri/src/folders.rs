#![allow(clippy::needless_pass_by_value)]

pub mod model;
pub mod store;

use chrono::Utc;
use tauri::State;

use crate::count::saturating_u32 as count;
use crate::db::{Db, lock};
use crate::error::AppError;
use model::{Folder, FolderColour, FolderDraft, NoteFiling};

/// `None` = every space, like [`crate::notes::view::NotesQuery::space_id`].
#[tauri::command(async)]
#[specta::specta]
pub fn list_folders(space_id: Option<String>, db: State<'_, Db>) -> Result<Vec<Folder>, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::list(&mut connection, space_id.as_deref())?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn create_folder(draft: FolderDraft, db: State<'_, Db>) -> Result<Folder, AppError> {
    let name = draft.validated_name()?;

    let mut connection = lock(&db)?;

    Ok(store::create(
        &mut connection,
        &draft.space_id,
        &name,
        Utc::now(),
    )?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn rename_folder(id: String, name: String, db: State<'_, Db>) -> Result<Folder, AppError> {
    let name = model::validated_name(&name)?;

    let mut connection = lock(&db)?;

    Ok(store::rename(&mut connection, &id, &name)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn recolour_folder(
    id: String,
    colour: FolderColour,
    db: State<'_, Db>,
) -> Result<Folder, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::recolour(&mut connection, &id, colour)?)
}

/// ⚠️ No refuge argument, unlike [`crate::spaces::delete_space`]: the notes come out
/// loose, and "no folder" is a legitimate state rather than data loss.
#[tauri::command(async)]
#[specta::specta]
pub fn delete_folder(id: String, db: State<'_, Db>) -> Result<(), AppError> {
    let mut connection = lock(&db)?;

    Ok(store::delete(&mut connection, &id)?)
}

/// A batch, like [`crate::notes::move_notes`]: the selection bar files a whole selection,
/// and a drop on the board is a batch of one. `folderId` absent unfiles.
#[tauri::command(async)]
#[specta::specta]
pub fn file_notes(
    ids: Vec<String>,
    folder_id: Option<String>,
    db: State<'_, Db>,
) -> Result<Vec<NoteFiling>, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::file_many(
        &mut connection,
        &ids,
        folder_id.as_deref(),
        Utc::now(),
    )?)
}

/// The undo of [`file_notes`]: each note goes back to the folder it left, or back to
/// being loose.
#[tauri::command(async)]
#[specta::specta]
pub fn file_notes_back(filings: Vec<NoteFiling>, db: State<'_, Db>) -> Result<u32, AppError> {
    let mut connection = lock(&db)?;

    Ok(count(store::restore_filings(&mut connection, &filings)?))
}
