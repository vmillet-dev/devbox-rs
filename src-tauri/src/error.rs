//! No user-facing text leaves this module: a `String` would put French in the
//! English UI and force callers to parse prose. The front end maps `code` onto a
//! translation key and interpolates `params`.

use std::collections::BTreeMap;

use serde::Serialize;
use specta::Type;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("Invalid field \"{field}\": {detail}")]
pub struct ValidationError {
    /// The offending field, spelled the way the front names it.
    pub field: &'static str,
    pub detail: String,
}

impl ValidationError {
    pub fn new(field: &'static str, detail: impl Into<String>) -> Self {
        Self {
            field,
            detail: detail.into(),
        }
    }
}

/// Each variant becomes a **code** the front end translates; `Display` is only the
/// technical detail, which may stay in French when it comes from an external error.
#[derive(Debug, Error)]
pub enum StorageError {
    /// Never a silent `Ok`: the front would believe the write went through.
    #[error("Note not found: {0}")]
    NoteNotFound(String),
    #[error("Space not found: {0}")]
    SpaceNotFound(String),
    #[error("A space named \"{0}\" already exists")]
    DuplicateSpaceName(String),
    #[error("Attachment not found: {0}")]
    AttachmentNotFound(String),
    #[error("File error: {0}")]
    File(String),
    #[error("Unreadable export file: {0}")]
    ImportFormat(String),
    #[error("Note \"{id}\" unreadable: field \"{field}\" is out of format")]
    CorruptRow { id: String, field: &'static str },
    #[error("Database carrying migration \"{0}\", unknown to this version of DevBox")]
    SchemaTooRecent(String),
    #[error("Migration failed: {0}")]
    Migration(String),
    /// `#[from]`: required by `Connection::transaction`. `#[source]` comes along for
    /// free, where an overridden `impl Display` used to lose the cause chain.
    #[error("Storage error: {0}")]
    Sqlite(#[from] diesel::result::Error),
}

/// Adding a variant breaks the front-end build until `CODE_KEYS`
/// (`core/errors/error-notifier.service.ts`) and both locales have their key.
///
/// No "schema too recent" variant: that failure aborts startup during the
/// migration, so no command can ever return it.
#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NoteNotFound,
    SpaceNotFound,
    DuplicateSpaceName,
    AttachmentNotFound,
    FileAccess,
    ImportFormat,
    /// The `field` parameter names the offending field.
    InvalidInput,
    /// Poisoned mutex: a command panicked while holding the connection.
    StorageUnavailable,
    Storage,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    /// Values to interpolate into the translated message, e.g. `{ "name": "Personal" }`.
    pub params: BTreeMap<String, String>,
    pub detail: String,
}

impl AppError {
    fn new(code: ErrorCode, detail: String) -> Self {
        Self {
            code,
            params: BTreeMap::new(),
            detail,
        }
    }

    fn with(code: ErrorCode, detail: String, key: &str, value: &str) -> Self {
        let mut error = Self::new(code, detail);
        error.params.insert(key.to_string(), value.to_string());
        error
    }

    pub fn storage_unavailable() -> Self {
        Self::new(
            ErrorCode::StorageUnavailable,
            "Storage unavailable: a previous operation failed".to_string(),
        )
    }
}

impl From<ValidationError> for AppError {
    fn from(error: ValidationError) -> Self {
        Self::with(
            ErrorCode::InvalidInput,
            error.to_string(),
            "field",
            error.field,
        )
    }
}

impl From<StorageError> for AppError {
    fn from(error: StorageError) -> Self {
        let detail = error.to_string();

        match error {
            StorageError::NoteNotFound(id) => {
                Self::with(ErrorCode::NoteNotFound, detail, "id", &id)
            }
            StorageError::SpaceNotFound(id) => {
                Self::with(ErrorCode::SpaceNotFound, detail, "id", &id)
            }
            StorageError::DuplicateSpaceName(name) => {
                Self::with(ErrorCode::DuplicateSpaceName, detail, "name", &name)
            }
            StorageError::AttachmentNotFound(id) => {
                Self::with(ErrorCode::AttachmentNotFound, detail, "id", &id)
            }
            StorageError::File(_) => Self::new(ErrorCode::FileAccess, detail),
            StorageError::ImportFormat(_) => Self::new(ErrorCode::ImportFormat, detail),
            // Nothing here gives the front end anything to do beyond reporting the
            // failure; `detail` carries the rest in plain text.
            StorageError::SchemaTooRecent(_)
            | StorageError::Migration(_)
            | StorageError::CorruptRow { .. }
            | StorageError::Sqlite(_) => Self::new(ErrorCode::Storage, detail),
        }
    }
}
