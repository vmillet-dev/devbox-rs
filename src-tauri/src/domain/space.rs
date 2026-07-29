//! L'espace : le classeur dans lequel les notes sont rangées. C'est le
//! `space_id` de la note qui porte la relation.
//!
//! Aucune entrée « Tous les espaces » côté données : c'est un mode d'affichage,
//! et en créer un ferait ranger des notes dedans.

use serde::{Deserialize, Serialize};

use super::rules::ValidationError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    /// L'unicité, insensible à la casse, est tranchée par la persistance : un
    /// doublon ressort en `ErrorCode::DuplicateSpaceName`.
    pub name: String,
}

/// Pas d'identifiant : il est attribué par la persistance.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceDraft {
    pub name: String,
}

impl SpaceDraft {
    /// Nom détouré et non vide. Le détourage n'est pas cosmétique :
    /// `COLLATE NOCASE` ne replie pas les espaces, donc « Perso » et « Perso »
    /// suivi d'une espace cohabiteraient, affichés à l'identique.
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

/// `rename_all` est sans effet tant que les champs tiennent en un mot : ces
/// tests échoueront le jour où un `created_at` s'ajoutera sans l'attribut, au
/// lieu de laisser le front lire `undefined`.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_space_serialises_with_the_keys_the_front_reads() {
        let json = serde_json::to_value(Space {
            id: "s-1".to_string(),
            name: "Perso".to_string(),
        })
        .unwrap();

        assert_eq!(json, serde_json::json!({ "id": "s-1", "name": "Perso" }));
    }

    #[test]
    fn a_draft_is_read_from_the_payload_the_front_sends() {
        let draft: SpaceDraft =
            serde_json::from_value(serde_json::json!({ "name": "Boulot" })).unwrap();

        assert_eq!(draft.name, "Boulot");
    }

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
