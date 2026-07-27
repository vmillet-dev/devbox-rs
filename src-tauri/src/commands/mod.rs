//! Point d'entrée unique pour toutes les commandes Tauri exposées au front Angular.
//!
//! Cette couche est **mince par contrat** : elle verrouille la connexion,
//! délègue, et traduit l'erreur. Toute décision appartient à `crate::domain`,
//! tout SQL à `crate::storage`. Une commande qui grossit est le signe qu'une
//! règle a été écrite au mauvais endroit.
//!
//! - `error`      : erreur commune traversant le pont (code + paramètres)
//! - `notes`      : prise de notes et interrogation de la vue
//! - `spaces`     : espaces de rangement des notes
//! - `crypto`     : hashing / chiffrement           (à implémenter)
//! - `formatters` : encodage, décodage, formatage   (à implémenter)
//!
//! Pour ajouter une nouvelle commande :
//! 1. L'écrire dans le fichier du domaine concerné (ou en créer un nouveau ici).
//! 2. La déclarer `pub` et l'annoter avec `#[tauri::command]`.
//! 3. L'enregistrer dans `tauri::generate_handler![...]` au sein de `lib.rs`.
//! 4. Lui faire renvoyer `Result<_, AppError>` — jamais `Result<_, String>`,
//!    voir `error.rs`.

pub mod error;
pub mod notes;
pub mod spaces;

use crate::storage::Db;
use error::AppError;

/// Prend le verrou sur la connexion partagée.
///
/// Un mutex empoisonné signifie qu'une commande a paniqué en le tenant : la
/// base peut être incohérente, autant le dire au front plutôt que de paniquer
/// une seconde fois.
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
