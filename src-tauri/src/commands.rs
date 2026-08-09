//! Adaptateurs Tauri : verrouiller, déléguer, traduire l'erreur.

// Une commande reçoit ses arguments désérialisés depuis la charge utile IPC :
// ils arrivent possédés, qu'elle les consomme ou non.
#![allow(clippy::needless_pass_by_value)]

pub mod error;
pub mod notes;
pub mod spaces;
pub mod tray;

#[cfg(test)]
mod tests;

use std::sync::Mutex;

use error::AppError;

/// `SqliteConnection` n'est pas `Sync` : deux commandes qui se chevauchent se
/// sérialisent sur ce mutex.
pub type Db = Mutex<diesel::SqliteConnection>;

/// Un mutex empoisonné signifie qu'une commande a paniqué en le tenant : mieux
/// vaut le dire que paniquer à nouveau.
fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, diesel::SqliteConnection>, AppError> {
    db.lock().map_err(|_| AppError::storage_unavailable())
}
