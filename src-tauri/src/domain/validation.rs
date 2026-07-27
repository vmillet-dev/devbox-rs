//! Refus d'une donnée reçue du front.
//!
//! # Pourquoi le back valide ce que le front contrôle déjà
//!
//! L'interface n'offre pas de créer un espace sans nom ni de choisir un langage
//! inexistant. Mais la doctrine du projet est que **le back fait autorité** : si
//! une règle n'est tenue que par un formulaire, elle n'est pas tenue. Un appel
//! direct au pont, un front d'une autre version ou un bug d'affichage suffisent
//! à écrire en base une donnée que plus rien ne pourra interpréter.
//!
//! Le refus voyage comme n'importe quelle autre erreur : un **code** et un
//! paramètre `field`, jamais une phrase rédigée en français.

use std::fmt;

/// Donnée reçue non conforme au contrat du domaine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    /// Champ en cause, tel que le front le nomme — sert de paramètre au message traduit.
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

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Champ « {} » invalide : {}", self.field, self.detail)
    }
}

impl std::error::Error for ValidationError {}
