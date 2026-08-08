//! Commandes Tauri exposées au front : verrouiller, déléguer, traduire l'erreur.
//!
//! Une commande qui grossit signale qu'une règle est au mauvais endroit — les
//! décisions vivent dans `crate::domain`, le SQL dans `crate::storage`.
//!
//! Une nouvelle commande doit être `pub`, annotée `#[tauri::command]`, renvoyer
//! `Result<_, AppError>` et être enregistrée dans `generate_handler!` (`lib.rs`).
//! `tray` fait exception au `Result` — voir son module.

pub mod error;
pub mod notes;
pub mod spaces;
pub mod tray;

use crate::storage::Db;
use error::AppError;

/// Verrou sur la connexion partagée. Un mutex empoisonné signifie qu'une
/// commande a paniqué en le tenant : mieux vaut le dire que paniquer à nouveau.
///
/// Le garde est rendu **mutable** : Diesel prend la connexion en exclusif à
/// chaque requête, y compris en lecture.
fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, diesel::SqliteConnection>, AppError> {
    db.lock().map_err(|_| AppError::storage_unavailable())
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::prelude::*;
    use error::ErrorCode;
    use std::sync::Mutex;

    fn in_memory() -> Db {
        Mutex::new(diesel::SqliteConnection::establish(":memory:").unwrap())
    }

    #[test]
    fn a_healthy_connection_is_handed_over() {
        let db = in_memory();

        assert!(lock(&db).is_ok());
    }

    #[test]
    fn a_poisoned_connection_is_reported_instead_of_panicking_again() {
        let db = in_memory();

        // Poison it the way production would: a panic while the guard is held.
        // The hook is silenced so a deliberate panic does not look like a crash.
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = db.lock().unwrap();
            panic!("une commande a paniqué en tenant la connexion");
        }));
        std::panic::set_hook(hook);

        // `unwrap_err()` would need the guard to be `Debug`, which
        // `SqliteConnection` is not; and `unwrap()` in `lock` itself would take
        // the whole process down on the next command.
        let Err(error) = lock(&db) else {
            panic!("un mutex empoisonné doit être signalé, pas rendu");
        };

        assert!(matches!(error.code, ErrorCode::StorageUnavailable));
    }
}
