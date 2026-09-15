#![allow(clippy::needless_pass_by_value)]

pub mod bundle;
pub mod file;
pub mod model;

use tauri::{AppHandle, State};

use crate::attachments;
use crate::db::{Db, lock};
use crate::error::AppError;
use crate::notes::store as notes;
use model::{ExportReport, ImportReport};

/// The spaces travel with the notes, or an import holds an id with nowhere to file it.
#[tauri::command(async)]
#[specta::specta]
pub fn export_notes(
    path: String,
    space_id: Option<String>,
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<ExportReport, AppError> {
    model::validate_path(&path)?;

    let exported = {
        let mut connection = lock(&db)?;
        let notes = notes::all(&mut connection, space_id.as_deref())?;
        bundle::collect(&mut connection, notes)?
    };

    file::write(&path, &exported, &attachments::directory(&app)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn export_selection(
    path: String,
    ids: Vec<String>,
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<ExportReport, AppError> {
    model::validate_path(&path)?;

    let exported = {
        let mut connection = lock(&db)?;
        let notes = notes::by_ids(&mut connection, &ids)?;
        bundle::collect(&mut connection, notes)?
    };

    file::write(&path, &exported, &attachments::directory(&app)?)
}

/// ⚠️ The file is read before the lock is taken: parsing a large export while holding the
/// connection would block every other command for the length of it.
#[tauri::command(async)]
#[specta::specta]
pub fn import_notes(
    path: String,
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<ImportReport, AppError> {
    model::validate_path(&path)?;

    let (imported, mut payload) = file::read(&path)?;
    let directory = attachments::directory(&app)?;

    let mut connection = lock(&db)?;

    Ok(bundle::merge(
        &mut connection,
        imported,
        &mut payload,
        &directory,
    )?)
}

/// Nothing is sent anywhere: "share" stops at the clipboard.
#[tauri::command(async)]
#[specta::specta]
pub fn share_notes(ids: Vec<String>, db: State<'_, Db>) -> Result<String, AppError> {
    let mut connection = lock(&db)?;
    let selected = notes::by_ids(&mut connection, &ids)?;
    let names = bundle::space_names(&mut connection)?;

    Ok(model::to_markdown(&selected, &names))
}
