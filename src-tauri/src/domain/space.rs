//! L'espace : le classeur dans lequel les notes sont rangées.
//!
//! Aucune entrée « Tous les espaces » côté données : c'est un mode d'affichage,
//! et en créer un ferait ranger des notes dedans.

use serde::{Deserialize, Serialize};
use specta::Type;

use super::error::ValidationError;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    /// Unicité insensible à la casse, tranchée par la persistance.
    pub name: String,
}

/// Pas d'identifiant : la persistance l'attribue.
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpaceDraft {
    pub name: String,
}

impl SpaceDraft {
    /// ⚠️ Le détourage n'est pas cosmétique : `COLLATE NOCASE` ne replie pas les
    /// espaces, donc « Perso » et « Perso » cohabiteraient, identiques à l'écran.
    pub fn validated_name(&self) -> Result<String, ValidationError> {
        let trimmed = self.name.trim();
        if trimmed.is_empty() {
            return Err(ValidationError::new(
                "name",
                "un espace doit porter un nom lisible",
            ));
        }

        Ok(trimmed.to_string())
    }
}

/// Un espace ne peut pas être son propre refuge : le `ON DELETE CASCADE`
/// emporterait les notes juste après le transfert. La persistance ne peut pas
/// trancher — des deux côtés, l'espace existe.
pub fn validate_move_target(id: &str, target_id: &str) -> Result<(), ValidationError> {
    if id == target_id {
        return Err(ValidationError::new(
            "targetSpaceId",
            "les notes doivent être déplacées vers un autre espace",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(name: &str) -> SpaceDraft {
        SpaceDraft {
            name: name.to_string(),
        }
    }

    #[test]
    fn a_name_is_trimmed_before_being_stored() {
        // NOCASE folds case but not whitespace: without this, "Perso " would
        // slip past the uniqueness check and sit next to "Perso", identical on screen.
        assert_eq!(draft("  Perso  ").validated_name().unwrap(), "Perso");
    }

    #[test]
    fn a_blank_name_is_refused_with_its_field() {
        for blank in ["", "   ", "\t\n"] {
            let error = draft(blank).validated_name().unwrap_err();
            assert_eq!(error.field, "name");
        }
    }

    #[test]
    fn a_space_cannot_be_its_own_move_target() {
        // The cascade would take the notes back out a statement later, so this
        // has to be refused before any SQL runs.
        let error = validate_move_target("s-1", "s-1").unwrap_err();

        assert_eq!(error.field, "targetSpaceId");
    }

    #[test]
    fn another_space_is_an_acceptable_move_target() {
        assert!(validate_move_target("s-1", "s-2").is_ok());
    }
}
