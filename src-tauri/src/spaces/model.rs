//! No "All spaces" entry on the data side: it is a display mode, and creating one
//! would have notes filed into it.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::ValidationError;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub id: String,
    /// Uniqueness is case-insensitive, decided by persistence.
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpaceDraft {
    pub name: String,
}

impl SpaceDraft {
    /// ⚠️ Trimming is not cosmetic: `COLLATE NOCASE` does not collapse
    /// spaces, so "Perso" and " Perso " would coexist, identical on screen.
    pub fn validated_name(&self) -> Result<String, ValidationError> {
        let trimmed = self.name.trim();
        if trimmed.is_empty() {
            return Err(ValidationError::new(
                "name",
                "a space must have a readable name",
            ));
        }

        Ok(trimmed.to_string())
    }
}

/// A space cannot be its own refuge: the `ON DELETE CASCADE` would sweep away the
/// notes right after the transfer. Persistence cannot decide — from both sides, the
/// space exists.
pub fn validate_move_target(id: &str, target_id: &str) -> Result<(), ValidationError> {
    if id == target_id {
        return Err(ValidationError::new(
            "targetSpaceId",
            "notes must be moved to another space",
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
        let error = validate_move_target("s-1", "s-1").unwrap_err();

        assert_eq!(error.field, "targetSpaceId");
    }

    #[test]
    fn another_space_is_an_acceptable_move_target() {
        assert!(validate_move_target("s-1", "s-2").is_ok());
    }
}
