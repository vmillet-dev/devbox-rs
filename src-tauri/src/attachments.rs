//! The bytes cross the bridge only on read, as a `data:` URI: the `WebView`'s CSP
//! forbids loading a local file, and opening the `asset:` protocol to show a
//! screenshot would be a wide door for a narrow need.

// Commands receive their arguments owned, deserialized from the IPC payload.
#![allow(clippy::needless_pass_by_value)]

pub mod model;
pub mod store;

use std::io::Read;
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

/// ⚠️ The limit is enforced by the copy itself. Reading `metadata().len()` first and
/// copying afterwards left the two free to disagree: a file growing between them
/// landed whole, whatever the limit said.
fn copy_within_limit(source: &str, destination: &Path) -> Result<u32, AppError> {
    let mut reader = std::fs::File::open(source).map_err(|error| file_error(source, &error))?;
    let mut writer =
        std::fs::File::create(destination).map_err(|error| file_error(source, &error))?;

    let copied = std::io::copy(&mut reader.by_ref().take(model::MAX_BYTES + 1), &mut writer)
        .map_err(|error| file_error(source, &error))?;

    Ok(model::validate_size(copied)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn attach_file(
    note_id: String,
    path: String,
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<Attachment, AppError> {
    let file_name = model::display_name(&path)?;

    let mut attachment = Attachment {
        id: Uuid::new_v4().to_string(),
        note_id,
        mime_type: model::mime_of(&file_name),
        file_name,
        byte_size: 0,
        created_at: Utc::now(),
    };

    let directory = directory(&app)?;
    let destination = directory.join(attachment.stored_name());
    // Copy before the database write: a record without a file would show a
    // broken thumbnail, where a file without a record is swept at startup.
    match copy_within_limit(&path, &destination) {
        Ok(byte_size) => attachment.byte_size = byte_size,
        Err(error) => {
            remove_files(&directory, &[attachment.stored_name()]);
            return Err(error);
        }
    }

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

#[tauri::command(async)]
#[specta::specta]
pub fn list_attachments(note_id: String, db: State<'_, Db>) -> Result<Vec<Attachment>, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::list(&mut connection, &note_id)?)
}

#[tauri::command(async)]
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
#[tauri::command(async)]
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
#[tauri::command(async)]
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
#[tauri::command(async)]
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

#[tauri::command(async)]
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
        let mut connection = lock(db)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn scratch() -> PathBuf {
        let directory = std::env::temp_dir().join(format!("devbox-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();

        directory
    }

    #[test]
    fn a_file_within_the_limit_is_copied_whole() {
        let directory = scratch();
        let source = directory.join("capture.png");
        std::fs::write(&source, vec![7u8; 2048]).unwrap();
        let destination = directory.join("a-1.png");

        let copied = copy_within_limit(&source.to_string_lossy(), &destination).unwrap();

        assert_eq!(copied, 2048);
        assert_eq!(std::fs::read(&destination).unwrap().len(), 2048);
        std::fs::remove_dir_all(&directory).ok();
    }

    /// The limit is applied by the copy, so a file that grew past it after any
    /// earlier `metadata` read is still refused rather than stored whole.
    #[test]
    fn a_file_over_the_limit_is_refused_and_leaves_nothing_behind() {
        let directory = scratch();
        let source = directory.join("huge.bin");
        std::fs::write(
            &source,
            vec![0u8; usize::try_from(model::MAX_BYTES).unwrap() + 1],
        )
        .unwrap();
        let destination = directory.join("a-1.bin");

        let error = copy_within_limit(&source.to_string_lossy(), &destination).unwrap_err();

        assert!(matches!(error.code, ErrorCode::InvalidInput));
        assert_eq!(
            error.params.get("field").map(String::as_str),
            Some("byteSize")
        );
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_missing_source_is_reported_rather_than_panicking() {
        let directory = scratch();

        let error = copy_within_limit("no-such-file.png", &directory.join("a-1.png")).unwrap_err();

        assert!(matches!(error.code, ErrorCode::FileAccess));
        std::fs::remove_dir_all(&directory).ok();
    }
}
