//! Encryption at rest: the key, what it seals, and the one gate that opens the library.
//!
//! ⚠️ The passphrase is never stored, anywhere, deliberately — this is the bargain a password manager makes,
//! not a keychain's. Losing it loses the library, and an export is the only copy that does
//! not depend on it.

#![allow(clippy::needless_pass_by_value)]

pub mod file;
pub mod key;

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager, State};

use crate::db::{self, Db};
use crate::error::{AppError, StorageError, ValidationError};
use key::Cost;

/// Short enough to be typed at every launch, long enough to be worth deriving from.
const MINIMUM_LENGTH: usize = 8;

/// What the front end renders before it renders anything else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum VaultState {
    /// A library that has never been encrypted: the first launch asks for a passphrase
    /// twice and creates one.
    Absent,
    /// A key file is there and the passphrase has not been given yet.
    Locked,
    /// ⚠️ Held in Rust, never in the front end: a page reload must not ask again for a
    /// library this process already has open — which is also what keeps `reopenSession`
    /// working in the end-to-end suite.
    Unlocked,
}

#[tauri::command]
#[specta::specta]
pub fn vault_state(app: AppHandle, db: State<'_, Db>) -> Result<VaultState, AppError> {
    if db.lock().map_err(|_| StorageError::Unavailable)?.is_some() {
        return Ok(VaultState::Unlocked);
    }

    let directory = app.path().app_data_dir().map_err(storage)?;

    Ok(if file::exists(&directory) {
        VaultState::Locked
    } else {
        VaultState::Absent
    })
}

/// The first launch. ⚠️ Refuses a library that already has a key file rather than
/// replacing it: that file is the only way into the notes beside it.
#[tauri::command(async)]
#[specta::specta]
pub fn create_vault(passphrase: String, app: AppHandle, db: State<'_, Db>) -> Result<(), AppError> {
    validate(&passphrase)?;

    let directory = app.path().app_data_dir().map_err(storage)?;
    std::fs::create_dir_all(&directory).map_err(|error| storage_msg(&error.to_string()))?;

    let vault = file::create(&directory, &passphrase, Cost::default())?;

    adopt(&app, &db, vault)
}

/// ⚠️ Deliberately slow: deriving the key is the whole defence against someone trying
/// passphrases against a copied file. It is `(async)` for the same reason — 224 ms on the
/// main thread would freeze the window over every attempt.
#[tauri::command(async)]
#[specta::specta]
pub fn unlock_vault(passphrase: String, app: AppHandle, db: State<'_, Db>) -> Result<(), AppError> {
    let directory = app.path().app_data_dir().map_err(storage)?;
    let vault = file::unlock(&directory, &passphrase)?;

    adopt(&app, &db, vault)
}

/// Opens the library under the key, hands it to the rest of the application, and only
/// then runs what a startup used to run before there was anything to unlock.
fn adopt(app: &AppHandle, db: &State<'_, Db>, vault: key::Vault) -> Result<(), AppError> {
    let directory = app.path().app_data_dir().map_err(storage)?;
    let library = db::open(&directory.join(db::DB_FILE_NAME), vault)?;

    {
        let mut held = db.lock().map_err(|_| StorageError::Unavailable)?;
        // ⚠️ A second unlock would drop the library the first one opened, and with it any
        // connection state. The front gates on `vault_state`, so this only catches a race.
        if held.is_none() {
            *held = Some(library);
        }
    }

    crate::sweep(app);

    Ok(())
}

/// ⚠️ A length, and nothing else. A rule about digits and symbols pushes people towards
/// one memorable pattern, and the cost of guessing is Argon2id's to carry.
fn validate(passphrase: &str) -> Result<(), ValidationError> {
    if passphrase.chars().count() < MINIMUM_LENGTH {
        return Err(ValidationError::new(
            "passphrase",
            "a passphrase of at least 8 characters",
        ));
    }

    Ok(())
}

fn storage(error: tauri::Error) -> StorageError {
    StorageError::Vault(error.to_string())
}

fn storage_msg(detail: &str) -> StorageError {
    StorageError::Vault(detail.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_passphrase_too_short_to_be_worth_deriving_is_refused() {
        assert!(validate("short").is_err());
        assert!(validate("1234567").is_err());
    }

    #[test]
    fn a_passphrase_of_the_minimum_length_is_accepted() {
        assert!(validate("12345678").is_ok());
    }

    /// ⚠️ Counted in characters, not bytes: "clé-privée" is ten characters and twelve
    /// bytes, and a byte count would accept a shorter one through an accent.
    #[test]
    fn the_length_is_counted_in_characters() {
        assert!(validate("éàèùçâêîô").is_ok());
        assert!(validate("éàèùç").is_err());
    }
}
