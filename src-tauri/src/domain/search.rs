//! Correspondance d'une note avec un texte cherché.

use super::note::Note;

/// `needle` est attendu **déjà replié en minuscules et détouré**.
///
/// ⚠️ Le repliage est en Rust et non en SQL : sans ICU, le `LOWER()` de SQLite ne
/// traite que l'ASCII, donc `Étape` ne correspondrait pas à `étape`. D'où une
/// recherche qui ne descend pas dans le `WHERE`, contrairement aux filtres
/// grossiers, qui eux y restent indexés.
pub fn matches(note: &Note, needle: &str) -> bool {
    note.title.to_lowercase().contains(needle)
        || note
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(needle))
        || note.content.to_lowercase().contains(needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::fixtures::note as sample;

    #[test]
    fn the_title_the_tags_and_the_content_are_all_searched() {
        let note = Note {
            title: "Déploiement".to_string(),
            content: "kubectl apply".to_string(),
            tags: vec!["ops".to_string()],
            ..sample()
        };

        assert!(matches(&note, "déploi"));
        assert!(matches(&note, "kubectl"));
        assert!(matches(&note, "ops"));
        assert!(!matches(&note, "terraform"));
    }

    #[test]
    fn search_case_folding_reaches_beyond_ascii() {
        let note = Note {
            title: "Étape suivante".to_string(),
            ..sample()
        };

        // SQLite's LOWER() leaves É alone without ICU, so this match is exactly
        // what moving the comparison into Rust buys.
        assert!(matches(&note, "étape"));
    }
}
