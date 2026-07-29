//! Commandes Tauri exposées au front : verrouiller, déléguer, traduire l'erreur.
//!
//! Une commande qui grossit signale qu'une règle est au mauvais endroit — les
//! décisions vivent dans `crate::domain`, le SQL dans `crate::storage`.
//!
//! Une nouvelle commande doit être `pub`, annotée `#[tauri::command]`, renvoyer
//! `Result<_, AppError>` et être enregistrée dans `generate_handler!` (`lib.rs`).

pub mod error;
pub mod notes;
pub mod spaces;

use crate::storage::Db;
use error::AppError;

/// Verrou sur la connexion partagée. Un mutex empoisonné signifie qu'une
/// commande a paniqué en le tenant : mieux vaut le dire que paniquer à nouveau.
fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, AppError> {
    db.lock().map_err(|_| AppError::storage_unavailable())
}

#[cfg(test)]
mod tests {
    use super::*;
    use error::ErrorCode;
    use std::sync::Mutex;

    #[test]
    fn a_healthy_connection_is_handed_over() {
        let db: Db = Mutex::new(rusqlite::Connection::open_in_memory().unwrap());

        assert!(lock(&db).is_ok());
    }

    #[test]
    fn a_poisoned_connection_is_reported_instead_of_panicking_again() {
        let db: Db = Mutex::new(rusqlite::Connection::open_in_memory().unwrap());

        // Poison it the way production would: a panic while the guard is held.
        // The hook is silenced so a deliberate panic does not look like a crash.
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = db.lock().unwrap();
            panic!("une commande a paniqué en tenant la connexion");
        }));
        std::panic::set_hook(hook);

        let error = lock(&db).unwrap_err();

        // `unwrap()` here would take the whole process down on the next command.
        assert!(matches!(error.code, ErrorCode::StorageUnavailable));
    }
}
