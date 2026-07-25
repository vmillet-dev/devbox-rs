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

use crate::storage::StorageError;

/// Identifie la cause pour le front, qui en dérive `errors.<code>` ou choisit
/// un message contextuel. Ajouter une variante = ajouter la traduction en face
/// (`IpcErrorCode` dans `src/app/core/ipc/ipc-error.ts`).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NoteNotFound,
    SpaceNotFound,
    DuplicateSpaceName,
    SchemaTooRecent,
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
            StorageError::SchemaTooRecent(version) => Self::with(
                ErrorCode::SchemaTooRecent,
                detail,
                "version",
                &version.to_string(),
            ),
            StorageError::Sqlite(_) => Self::new(ErrorCode::Storage, detail),
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
    fn params_are_absent_rather_than_null_when_there_is_nothing_to_interpolate() {
        let json = serde_json::to_value(AppError::storage_unavailable()).unwrap();

        assert_eq!(json["code"], "storageUnavailable");
        assert_eq!(json["params"], serde_json::json!({}));
    }
}
