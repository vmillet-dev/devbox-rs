//! The bytes cross the bridge only on read, as a `data:` URI: the `WebView`'s CSP
//! forbids loading a local file, and opening the `asset:` protocol to show a
//! screenshot would be a wide door for a narrow need.

// Commands receive their arguments owned, deserialised from the IPC payload.
#![allow(clippy::needless_pass_by_value)]

pub mod model;
pub mod store;

use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::Utc;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::db::{Db, lock};
use crate::error::{AppError, StorageError};
use model::Attachment;

const DIRECTORY: &str = "attachments";

fn file_error(context: &str, error: &std::io::Error) -> StorageError {
    StorageError::File(format!("{context}: {error}"))
}

/// Created on demand, so an installation that never attached anything has none.
pub(crate) fn directory(app: &AppHandle) -> Result<PathBuf, StorageError> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| StorageError::File(format!("app_data_dir: {error}")))?
        .join(DIRECTORY);
    std::fs::create_dir_all(&path).map_err(|error| file_error("attachments directory", &error))?;

    Ok(path)
}

/// Deletes without reporting: a file already gone is the intended result, and a
/// purge must not fail because the disk was tidied by hand.
pub(crate) fn remove_files(directory: &Path, stored_names: &[String]) {
    for name in stored_names {
        let path = directory.join(name);
        if let Err(error) = std::fs::remove_file(&path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            log::warn!("Attachment file {} not removed: {error}", path.display());
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn attach_file(
    note_id: String,
    path: String,
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<Attachment, AppError> {
    let file_name = model::display_name(&path)?;
    let source = PathBuf::from(&path);
    let byte_size = model::validate_size(
        std::fs::metadata(&source)
            .map_err(|error| file_error(&path, &error))?
            .len(),
    )?;

    let attachment = Attachment {
        id: Uuid::new_v4().to_string(),
        note_id,
        mime_type: model::mime_of(&file_name),
        file_name,
        byte_size,
        created_at: Utc::now(),
    };

    let directory = directory(&app)?;
    let destination = directory.join(attachment.stored_name());
    // Copy before the database write: a record without a file would show a
    // broken thumbnail, where a file without a record is swept at startup.
    std::fs::copy(&source, &destination).map_err(|error| file_error(&path, &error))?;

    let mut connection = lock(&db)?;
    if let Err(error) = store::create(&mut connection, &attachment) {
        remove_files(&directory, &[attachment.stored_name()]);
        return Err(error.into());
    }

    Ok(attachment)
}

/// Checks the record exists first: opening or copying a file nothing refers to
/// would be a leak out of the directory.
fn locate(id: &str, app: &AppHandle, db: &Db) -> Result<PathBuf, AppError> {
    let stored_name = {
        let mut connection = lock(db)?;
        store::find(&mut connection, id)?
            .ok_or_else(|| StorageError::AttachmentNotFound(id.to_string()))?
            .stored_name()
    };

    Ok(directory(app)?.join(stored_name))
}

fn write_attachment(
    note_id: String,
    file_name: String,
    bytes: Vec<u8>,
    app: &AppHandle,
    db: &Db,
) -> Result<Attachment, AppError> {
    let byte_size = model::validate_size(bytes.len() as u64)?;

    let attachment = Attachment {
        id: Uuid::new_v4().to_string(),
        note_id,
        mime_type: model::mime_of(&file_name),
        file_name,
        byte_size,
        created_at: Utc::now(),
    };

    let directory = directory(app)?;
    let destination = directory.join(attachment.stored_name());
    std::fs::write(&destination, bytes)
        .map_err(|error| file_error(&attachment.file_name, &error))?;

    let mut connection = lock(db)?;
    if let Err(error) = store::create(&mut connection, &attachment) {
        remove_files(&directory, &[attachment.stored_name()]);
        return Err(error.into());
    }

    Ok(attachment)
}

#[tauri::command]
#[specta::specta]
pub fn list_attachments(note_id: String, db: State<'_, Db>) -> Result<Vec<Attachment>, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::list(&mut connection, &note_id)?)
}

#[tauri::command]
#[specta::specta]
pub fn read_attachment(id: String, app: AppHandle, db: State<'_, Db>) -> Result<String, AppError> {
    let attachment = {
        let mut connection = lock(&db)?;
        store::find(&mut connection, &id)?
            .ok_or_else(|| StorageError::AttachmentNotFound(id.clone()))?
    };

    let path = directory(&app)?.join(attachment.stored_name());
    let bytes = std::fs::read(&path).map_err(|error| file_error(&attachment.file_name, &error))?;

    Ok(format!(
        "data:{};base64,{}",
        attachment.mime_type,
        STANDARD.encode(bytes)
    ))
}

/// The call starts from **Rust**, not the `WebView`: opening a path from the front
/// end would have meant allowing `opener:allow-open-path` over a whole directory.
#[tauri::command]
#[specta::specta]
pub fn open_attachment(id: String, app: AppHandle, db: State<'_, Db>) -> Result<(), AppError> {
    let path = locate(&id, &app, &db)?;

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| StorageError::File(format!("open: {error}")))?;

    Ok(())
}

/// The path comes from a native picker; the write stays here, the only place that
/// knows the directory.
#[tauri::command]
#[specta::specta]
pub fn save_attachment(
    id: String,
    path: String,
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<(), AppError> {
    let source = locate(&id, &app, &db)?;

    std::fs::copy(&source, &path).map_err(|error| file_error(&path, &error))?;

    Ok(())
}

/// The bytes do **not** cross the bridge: the clipboard is read natively, where the
/// image arrives as raw RGBA, then encoded to PNG.
#[tauri::command]
#[specta::specta]
pub fn attach_clipboard_image(
    note_id: String,
    file_name: String,
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<Attachment, AppError> {
    let image = tauri_plugin_clipboard_manager::ClipboardExt::clipboard(&app)
        .read_image()
        .map_err(|error| StorageError::File(format!("clipboard image: {error}")))?;

    let png = model::encode_png(image.width(), image.height(), image.rgba())?;

    write_attachment(note_id, model::png_name(&file_name), png, &app, &db)
}

#[tauri::command]
#[specta::specta]
pub fn delete_attachment(id: String, app: AppHandle, db: State<'_, Db>) -> Result<(), AppError> {
    let directory = directory(&app)?;

    let mut connection = lock(&db)?;
    let stored_name = store::find(&mut connection, &id)?
        .ok_or_else(|| StorageError::AttachmentNotFound(id.clone()))?
        .stored_name();
    store::delete(&mut connection, &id)?;
    drop(connection);

    remove_files(&directory, &[stored_name]);

    Ok(())
}

/// Files no record claims any more: a copy interrupted between `fs::copy` and
/// the insert leaves one, and so does a trash purge that fails in between.
pub fn sweep_orphan_files(app: &AppHandle, db: &Db) -> Result<usize, StorageError> {
    let directory = directory(app)?;

    let known = {
        let mut connection = db.lock().map_err(|_| {
            StorageError::File("attachments sweep: poisoned connection".to_string())
        })?;
        store::all_stored_names(&mut connection)?
    };

    let entries =
        std::fs::read_dir(&directory).map_err(|error| file_error("attachments sweep", &error))?;

    let orphans: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !known.contains(name))
        .collect();

    remove_files(&directory, &orphans);

    Ok(orphans.len())
}
