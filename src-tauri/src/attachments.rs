//! Pièces jointes : commandes, et le seul endroit qui touche au disque.
//!
//! Les octets ne traversent le pont qu'à la lecture, sous forme de `data:` URI —
//! le `CSP` de la `WebView` interdit de charger un fichier local, et ouvrir le
//! protocole `asset:` pour afficher une capture d'écran serait une porte bien
//! large pour un besoin bien étroit.

// Une commande reçoit ses arguments désérialisés depuis la charge utile IPC :
// ils arrivent possédés, qu'elle les consomme ou non.
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

/// Créé à la demande : une installation qui n'a jamais rien joint n'a pas de
/// dossier vide à traîner.
pub(crate) fn directory(app: &AppHandle) -> Result<PathBuf, StorageError> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| StorageError::File(format!("app_data_dir: {error}")))?
        .join(DIRECTORY);
    std::fs::create_dir_all(&path).map_err(|error| file_error("attachments directory", &error))?;

    Ok(path)
}

/// Efface sans rien signaler : un fichier déjà absent est le résultat voulu, et
/// une purge ne doit pas échouer parce que le disque a été nettoyé à la main.
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
    // Copie avant écriture en base : une fiche sans fichier afficherait une
    // vignette cassée, alors qu'un fichier sans fiche est ramassé au démarrage.
    std::fs::copy(&source, &destination).map_err(|error| file_error(&path, &error))?;

    let mut connection = lock(&db)?;
    if let Err(error) = store::create(&mut connection, &attachment) {
        remove_files(&directory, &[attachment.stored_name()]);
        return Err(error.into());
    }

    Ok(attachment)
}

/// Chemin sur le disque, après avoir vérifié que la fiche existe : ouvrir ou
/// recopier un fichier dont plus rien ne parle serait une fuite hors du dossier.
fn locate(id: &str, app: &AppHandle, db: &Db) -> Result<PathBuf, AppError> {
    let stored_name = {
        let mut connection = lock(db)?;
        store::find(&mut connection, id)?
            .ok_or_else(|| StorageError::AttachmentNotFound(id.to_string()))?
            .stored_name()
    };

    Ok(directory(app)?.join(stored_name))
}

/// Chemin commun de [`attach_file`] et [`attach_clipboard_image`] : les octets
/// sont déjà là, il reste à les poser puis à les déclarer, dans cet ordre.
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

/// `data:<mime>;base64,…`, directement affichable dans un `<img>` ou
/// téléchargeable par le front.
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

/// Ouvre la pièce jointe avec l'application par défaut du système.
///
/// L'appel part du **Rust**, pas de la `WebView` : les capacités contrôlent
/// l'API que la `WebView` invoque, et ouvrir un chemin depuis le front aurait
/// demandé d'autoriser `opener:allow-open-path` sur un dossier entier.
#[tauri::command]
#[specta::specta]
pub fn open_attachment(id: String, app: AppHandle, db: State<'_, Db>) -> Result<(), AppError> {
    let path = locate(&id, &app, &db)?;

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| StorageError::File(format!("open: {error}")))?;

    Ok(())
}

/// Recopie la pièce jointe là où l'utilisateur l'a demandé. Le chemin vient d'un
/// sélecteur natif ; l'écriture reste ici, seul endroit qui connaît le dossier.
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

/// Attache l'image du presse-papier.
///
/// Les octets ne traversent **pas** le pont : le presse-papier est lu côté
/// natif, où l'image arrive en RGBA brut, puis encodée en PNG. La faire monter
/// jusqu'au front pour la redescendre coûterait deux conversions et plusieurs
/// mégaoctets de JSON.
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

/// Fichiers que plus aucune fiche ne réclame : une copie interrompue entre
/// `fs::copy` et l'insertion en laisse un, et une purge de corbeille qui plante
/// entre les deux aussi.
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
