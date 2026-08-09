//! Un **code** stable que le front mappe sur une clé de traduction, ses
//! paramètres d'interpolation, et un détail technique. Aucun texte destiné à
//! l'utilisateur ne sort d'ici : une `String` mettrait du français dans
//! l'interface anglaise, et forcerait le front à analyser de la prose.

use std::collections::BTreeMap;

use serde::Serialize;
use specta::Type;

use crate::domain::error::ValidationError;
use crate::storage::StorageError;

/// Ajouter une variante casse la compilation du front tant que `CODE_KEYS`
/// (`core/errors/error-notifier.service.ts`) et les deux locales n'ont pas leur
/// clé.
///
/// Pas de variante « schéma trop récent » : cette panne avorte le lancement
/// pendant la migration, aucune commande ne peut la renvoyer.
#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    NoteNotFound,
    SpaceNotFound,
    DuplicateSpaceName,
    /// Le paramètre `field` nomme le champ en cause.
    InvalidInput,
    /// Mutex empoisonné : une commande a paniqué en tenant la connexion.
    StorageUnavailable,
    Storage,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    /// Valeurs à interpoler dans le message traduit, ex. `{ "name": "Perso" }`.
    pub params: BTreeMap<String, String>,
    /// Affiché en second plan de la bannière. Pas traduit, mais lisible.
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
            // Le nom voyage en paramètre : c'est lui que le front interpole.
            StorageError::DuplicateSpaceName(name) => {
                Self::with(ErrorCode::DuplicateSpaceName, detail, "name", &name)
            }
            // Aucune de ces causes ne donne au front autre chose à faire que
            // signaler la panne ; le `detail` porte le reste en clair.
            StorageError::SchemaTooRecent(_)
            | StorageError::Migration(_)
            | StorageError::CorruptRow { .. }
            | StorageError::Sqlite(_) => Self::new(ErrorCode::Storage, detail),
        }
    }
}
