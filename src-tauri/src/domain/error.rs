//! Refus d'une donnée reçue.

use thiserror::Error;

/// Voyage comme les autres erreurs : un code et un paramètre `field`, jamais une
/// phrase rédigée en français.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("Champ « {field} » invalide : {detail}")]
pub struct ValidationError {
    /// Champ en cause, tel que le front le nomme.
    pub field: &'static str,
    /// Détail technique, affiché en second plan.
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
