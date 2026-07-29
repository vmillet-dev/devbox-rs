//! Erreur traversant le pont Tauri : un **code** stable que le front mappe sur
//! une clé de traduction, ses **paramètres** d'interpolation, et un **détail**
//! technique. Aucun texte destiné à l'utilisateur ne sort d'ici — une `String`
//! mettrait du français dans l'interface anglaise et forcerait le front à
//! analyser de la prose pour réagir à une cause précise.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::domain::rules::ValidationError;
use crate::storage::StorageError;

/// ⚠️ Ajouter une variante impose d'ajouter la sienne dans `IpcErrorCode`
/// (`src/app/core/ipc/ipc-error.ts`) **et** sa clé dans les deux locales.
///
/// Pas de variante « schéma trop récent » : cette panne avorte le lancement
/// pendant la migration, aucune commande ne peut la renvoyer.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NoteNotFound,
    SpaceNotFound,
    DuplicateSpaceName,
    /// Donnée reçue non conforme. Le paramètre `field` nomme le champ en cause.
    InvalidInput,
    /// Mutex empoisonné : une commande a paniqué en tenant la connexion.
    StorageUnavailable,
    /// Panne de lecture ou d'écriture SQLite.
    Storage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    /// Valeurs à interpoler dans le message traduit, ex. `{ "name": "Perso" }`.
    pub params: BTreeMap<String, String>,
    /// Message technique, affiché en second plan de la bannière. Pas traduit,
    /// mais lisible.
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

    /// Mutex empoisonné : une commande a paniqué en le tenant, la base peut
    /// être incohérente.
    pub fn storage_unavailable() -> Self {
        Self::new(
            ErrorCode::StorageUnavailable,
            "Stockage indisponible : une opération précédente a échoué".to_string(),
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
            // Le nom voyage en paramètre : c'est lui que le front interpole,
            // sans jamais relire le message.
            StorageError::DuplicateSpaceName(name) => {
                Self::with(ErrorCode::DuplicateSpaceName, detail, "name", &name)
            }
            // Inatteignable par le pont (voir [`ErrorCode`]) ; `Storage` reste
            // honnête et le `detail` porte déjà la version en clair.
            StorageError::SchemaTooRecent(_) | StorageError::Sqlite(_) => {
                Self::new(ErrorCode::Storage, detail)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_serialises_in_camel_case() {
        let json = serde_json::to_value(AppError::from(StorageError::NoteNotFound(
            "n-1".to_string(),
        )))
        .unwrap();

        // The front discriminates on this exact spelling; serde's default would
        // emit "NoteNotFound" and every branch would silently fall through.
        assert_eq!(json["code"], "noteNotFound");
    }

    #[test]
    fn a_duplicate_space_name_carries_the_name_as_a_parameter() {
        let json = serde_json::to_value(AppError::from(StorageError::DuplicateSpaceName(
            "Perso".to_string(),
        )))
        .unwrap();

        // The translated message interpolates {{name}}; reading it back out of
        // `detail` would mean parsing a French sentence.
        assert_eq!(json["code"], "duplicateSpaceName");
        assert_eq!(json["params"]["name"], "Perso");
    }

    #[test]
    fn every_error_carries_a_non_empty_detail() {
        let errors = [
            StorageError::NoteNotFound("n-1".to_string()),
            StorageError::SpaceNotFound("s-1".to_string()),
            StorageError::DuplicateSpaceName("Perso".to_string()),
            StorageError::SchemaTooRecent(9),
        ];

        for error in errors {
            assert!(!AppError::from(error).detail.is_empty());
        }
    }

    #[test]
    fn a_refused_value_names_the_field_at_fault() {
        let json = serde_json::to_value(AppError::from(ValidationError::new(
            "language",
            "« rust » n'est pas un langage reconnu",
        )))
        .unwrap();

        // The front interpolates {{field}}; without it the banner would say
        // "a value was rejected" and leave the user guessing which one.
        assert_eq!(json["code"], "invalidInput");
        assert_eq!(json["params"]["field"], "language");
    }

    #[test]
    fn a_schema_too_recent_degrades_to_storage_rather_than_leaking_a_dead_code() {
        // It cannot cross the bridge (it aborts startup), so the front has no
        // branch for it — `storage` is the honest code, and the detail carries
        // the version in plain text.
        let error = AppError::from(StorageError::SchemaTooRecent(9));

        assert!(matches!(error.code, ErrorCode::Storage));
        assert!(error.detail.contains('9'));
    }

    #[test]
    fn params_are_absent_rather_than_null_when_there_is_nothing_to_interpolate() {
        let json = serde_json::to_value(AppError::storage_unavailable()).unwrap();

        assert_eq!(json["code"], "storageUnavailable");
        assert_eq!(json["params"], serde_json::json!({}));
    }
}
