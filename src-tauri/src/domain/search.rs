//! Correspondance d'une note avec un texte cherché.
//!
//! Le repliage de casse est fait **en Rust** et non en SQL : le `LOWER()` de
//! SQLite ne traite que l'ASCII (sans extension ICU), donc `Étape` ne
//! correspondrait pas à `étape`. `to_lowercase` est Unicode.
//!
//! C'est aussi pourquoi la recherche ne descend pas dans le `WHERE` : les
//! filtres grossiers — espace, épinglage, cycle de vie, tags — restent en SQL
//! où ils sont indexés, le texte est traité ici.

use super::note::Note;

/// `needle` est attendu **déjà replié en minuscules et détouré**.
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
    use crate::domain::note::Note;

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
    fn case_folding_reaches_beyond_ascii() {
        let note = Note {
            title: "Étape suivante".to_string(),
            ..sample()
        };

        // SQLite's LOWER() leaves É alone without ICU, so this match is exactly
        // what moving the comparison into Rust buys.
        assert!(matches(&note, "étape"));
    }
}
