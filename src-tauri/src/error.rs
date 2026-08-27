//! The crate's three errors, and the translation of the first two into the
//! third.
//!
//! [`ValidationError`] refuses an incoming value, [`StorageError`] reports a
//! persistence failure, [`AppError`] is what crosses the bridge: a stable
//! **code** the front maps onto a translation key, its interpolation parameters,
//! and a technical detail. No user-facing text leaves this module — a `String`
//! would put French in the English UI, and force callers to parse prose.

use std::collections::BTreeMap;

use serde::Serialize;
use specta::Type;
use thiserror::Error;

/// Travels like the others: a code and a `field` parameter, never a written
/// sentence.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("Invalid field \"{field}\": {detail}")]
pub struct ValidationError {
    /// The offending field, spelled the way the front names it.
    pub field: &'static str,
    /// Technical detail, shown in the background.
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

/// Each variant becomes a **code** the front translates, and `Display` is now
/// only the technical detail — which is why it may stay in French if it comes
/// from a system or external error.
#[derive(Debug, Error)]
pub enum StorageError {
    /// Never a silent `Ok`: the front would believe the write went through.
    #[error("Note not found: {0}")]
    NoteNotFound(String),
    /// The target space does not exist: the note would have nowhere to be filed.
    #[error("Space not found: {0}")]
    SpaceNotFound(String),
    /// Name already taken (case-insensitive comparison).
    #[error("A space named \"{0}\" already exists")]
    DuplicateSpaceName(String),
    #[error("Attachment not found: {0}")]
    AttachmentNotFound(String),
    /// Reading, copying or writing a file outside the database failed —
    /// attachments, export and import all land here.
    #[error("File error: {0}")]
    File(String),
    /// A file offered as an export bundle that is not one.
    #[error("Unreadable export file: {0}")]
    ImportFormat(String),
    /// A column no write from this code could have produced.
    #[error("Note \"{id}\" unreadable: field \"{field}\" is out of format")]
    CorruptRow { id: String, field: &'static str },
    /// A database carrying a migration this binary does not know: it was
    /// written by a newer version of the application.
    #[error("Database carrying migration \"{0}\", unknown to this version of DevBox")]
    SchemaTooRecent(String),
    /// Opening or migrating failed — a breakdown before the first `SELECT`.
    #[error("Migration failed: {0}")]
    Migration(String),
    /// `#[from]`: required by `Connection::transaction`, which needs to know how
    /// to absorb Diesel's error into the caller's. `#[source]` comes along for
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
    /// Reading or writing a file outside the database failed.
    FileAccess,
    /// The chosen file is not an export bundle this version can read.
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
    /// Values to interpolate into the translated message, e.g. `{ "name": "Perso" }`.
    pub params: BTreeMap<String, String>,
    /// Shown in the background of the banner. Not translated, but readable.
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
            // The name travels as a parameter: that is what the front interpolates.
            StorageError::DuplicateSpaceName(name) => {
                Self::with(ErrorCode::DuplicateSpaceName, detail, "name", &name)
            }
            StorageError::AttachmentNotFound(id) => {
                Self::with(ErrorCode::AttachmentNotFound, detail, "id", &id)
            }
            StorageError::File(_) => Self::new(ErrorCode::FileAccess, detail),
            StorageError::ImportFormat(_) => Self::new(ErrorCode::ImportFormat, detail),
            // None of these causes gives the front anything to do beyond
            // reporting the failure; `detail` carries the rest in plain text.
            StorageError::SchemaTooRecent(_)
            | StorageError::Migration(_)
            | StorageError::CorruptRow { .. }
            | StorageError::Sqlite(_) => Self::new(ErrorCode::Storage, detail),
        }
    }
}
