//! A folder cuts a space into regions. Its name and colour are domain and travel with an
//! export; ⚠️ where its zone sits on the board never enters this file — see `folders/board`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::closed_enum::closed_enum;
use crate::error::ValidationError;

closed_enum! {
    /// Assigned on creation rather than chosen, and changed from the zone menu after:
    /// drawing a folder must stay one gesture. The five are the theme's own accents, so
    /// each already has a light-theme twin.
    pub enum FolderColour {
        #[default]
        Blue = "blue",
        Amber = "amber",
        Purple = "purple",
        Green = "green",
        Red = "red",
    }
}

impl FolderColour {
    /// Rotates through the palette so two folders made back to back differ. ⚠️ Counted,
    /// not random: a deterministic colour is one a test can assert and a user can predict.
    pub fn nth(index: usize) -> Self {
        Self::ALL[index % Self::ALL.len()]
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub space_id: String,
    /// Uniqueness is case-insensitive inside its space, decided by persistence.
    pub name: String,
    #[serde(default)]
    pub colour: FolderColour,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FolderDraft {
    pub space_id: String,
    pub name: String,
}

/// What a card shows, resolved by the back end: the front end never joins an id against
/// a list it happens to hold.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteFolder {
    pub id: String,
    pub name: String,
    pub colour: FolderColour,
}

/// Which folder each note left, which is the only thing that can put a filing back.
/// `folder_id` is `None` for a note that was loose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteFiling {
    pub note_id: String,
    #[specta(optional)]
    pub folder_id: Option<String>,
}

/// ⚠️ Trimming is not cosmetic: the uniqueness check folds case but not spaces, so
/// "Perf" and " Perf " would coexist, identical on screen.
pub fn validated_name(raw: &str) -> Result<String, ValidationError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ValidationError::new(
            "name",
            "a folder must have a readable name",
        ));
    }

    Ok(trimmed.to_string())
}

impl FolderDraft {
    pub fn validated_name(&self) -> Result<String, ValidationError> {
        validated_name(&self.name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_trimmed_before_being_stored() {
        assert_eq!(validated_name("  Perf  ").unwrap(), "Perf");
    }

    #[test]
    fn a_blank_name_is_refused_with_its_field() {
        for blank in ["", "   ", "\t\n"] {
            assert_eq!(validated_name(blank).unwrap_err().field, "name");
        }
    }

    #[test]
    fn the_palette_rotates_and_wraps() {
        assert_eq!(FolderColour::nth(0), FolderColour::Blue);
        assert_eq!(FolderColour::nth(1), FolderColour::Amber);
        assert_eq!(
            FolderColour::nth(FolderColour::ALL.len()),
            FolderColour::Blue
        );
    }

    #[test]
    fn every_colour_survives_its_stored_spelling() {
        for colour in FolderColour::ALL {
            assert_eq!(colour.as_str().parse::<FolderColour>(), Ok(colour));
        }
    }
}
