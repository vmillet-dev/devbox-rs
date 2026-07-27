//! Erreur traversant le pont Tauri.
//!
//! # Pourquoi pas une `String`
//!
//! Les commandes renvoyaient `Result<_, String>`, et le front affichait la
//! chaîne telle quelle. Deux conséquences, toutes deux gênantes maintenant que
//! les règles métier vivent ici :
//!
//! - le message est rédigé en français **dans le binaire**, donc l'interface
//!   anglaise affichait du français dès qu'une règle du back se déclenchait ;
//! - pour réagir à une erreur précise (« ce nom d'espace est déjà pris »), le
//!   front n'avait que l'analyse de la chaîne — qui casse au premier reformulage.
//!
//! D'où [`AppError`] : un **code** stable que le front mappe sur une clé de
//! traduction, ses **paramètres** d'interpolation, et un **détail** technique
//! affiché en second plan. Aucun texte destiné à l'utilisateur ne sort d'ici.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::domain::validation::ValidationError;
use crate::storage::StorageError;

/// Identifie la cause pour le front, qui la mappe sur une clé de traduction.
/// Ajouter une variante = ajouter la variante en face (`IpcErrorCode` dans
/// `src/app/core/ipc/ipc-error.ts`) **et** sa clé dans les deux locales.
///
/// Il n'y a pas de variante pour un schéma trop récent : cette panne n'est
/// produite que par la migration, pendant le `setup()` de Tauri, où l'échec
/// avorte le lancement. Aucune commande ne peut la renvoyer, donc lui donner un
/// code laisserait croire au front qu'il a quelque chose à en faire.
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
    /// Valeurs à interpoler dans le message traduit, ex. `{ "name": "Perso" }`
    /// pour `errors.spaceNameTaken`. Vide quand le message n'en attend pas.
    pub params: BTreeMap<String, String>,
    /// Message technique. Le front l'affiche en second plan de la bannière : il
    /// n'a pas à être traduit, mais il doit rester lisible.
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

    /// Connexion inaccessible. Le mutex n'est empoisonné que si une commande a
    /// paniqué en le tenant : la base peut alors être incohérente, autant le
    /// dire au lieu de paniquer une seconde fois.
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
        // `detail` reprend le `Display` de `StorageError` : ces messages
        // existaient déjà et restent utiles — ils changent seulement de rôle,
        // de texte principal à détail technique.
        let detail = error.to_string();

        match error {
            StorageError::NoteNotFound(id) => {
                Self::with(ErrorCode::NoteNotFound, detail, "id", &id)
            }
            StorageError::SpaceNotFound(id) => {
                Self::with(ErrorCode::SpaceNotFound, detail, "id", &id)
            }
            // Le nom voyage en paramètre : c'est lui que le front interpole
            // dans `errors.spaceNameTaken`, sans jamais relire le message.
            StorageError::DuplicateSpaceName(name) => {
                Self::with(ErrorCode::DuplicateSpaceName, detail, "name", &name)
            }
            // Inatteignable par le pont (voir [`ErrorCode`]) : si cette
            // conversion arrivait quand même, `Storage` reste vrai, et le
            // `detail` porte déjà le numéro de version en clair.
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
