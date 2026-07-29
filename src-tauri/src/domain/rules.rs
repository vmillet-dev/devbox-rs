//! Règles de validation et de correspondance, et le type d'erreur qu'elles
//! renvoient.
//!
//! Le back valide ce que le front contrôle déjà : une règle tenue par un seul
//! formulaire n'est pas tenue. Un appel direct au pont ou un front d'une autre
//! version suffisent à écrire une donnée que plus rien ne saura interpréter.

use std::fmt;

use super::note::Note;

/// Donnée reçue non conforme. Voyage comme les autres erreurs : un code et un
/// paramètre `field`, jamais une phrase rédigée en français.
#[derive(Debug, Clone, PartialEq, Eq)]
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

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Champ « {} » invalide : {}", self.field, self.detail)
    }
}

impl std::error::Error for ValidationError {}

/// Langages reconnus pour la coloration. **La** référence : le front en a un
/// miroir (`core/models/language.model.ts`) pour peupler son sélecteur et
/// dégrader vers `txt`, mais c'est ici que l'écriture est refusée.
pub const LANGUAGES: [&str; 13] = [
    "json", "js", "ts", "py", "sql", "yml", "toml", "xml", "html", "css", "sh", "md", "txt",
];

/// Langage par défaut, et **signal que le front n'a rien choisi** : c'est lui
/// que `create_note` remplace par une détection. Miroir de `FALLBACK_LANGUAGE`
/// côté front (`core/language/language.model.ts`).
pub const FALLBACK_LANGUAGE: &str = "txt";

pub fn validate_language(language: &str) -> Result<(), ValidationError> {
    if LANGUAGES.contains(&language) {
        return Ok(());
    }

    Err(ValidationError::new(
        "language",
        format!("« {language} » n'est pas un langage reconnu"),
    ))
}

/// Nettoie les tags : espaces, `#` de tête, vides et doublons.
///
/// Règle unique — le front envoie ce que l'utilisateur a tapé, la persistance
/// écrit ce que cette fonction renvoie, et la requête y fait passer les tags
/// sélectionnés, sinon un `#urgent` saisi ne retrouverait pas `urgent` stocké.
///
/// La déduplication est insensible à la casse et garde la première graphie ;
/// `COLLATE NOCASE` (migration 2) prolonge la règle à tout le corpus.
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut normalized: Vec<String> = Vec::new();

    for tag in tags {
        let cleaned = tag.trim().trim_start_matches('#').trim();
        if cleaned.is_empty() {
            continue;
        }

        let folded = cleaned.to_lowercase();
        if seen.contains(&folded) {
            continue;
        }

        seen.push(folded);
        normalized.push(cleaned.to_string());
    }

    normalized
}

/// Correspondance d'une note avec un texte cherché. `needle` est attendu **déjà
/// replié en minuscules et détouré**.
///
/// Le repliage est fait en Rust et non en SQL : le `LOWER()` de SQLite ne traite
/// que l'ASCII sans ICU, donc `Étape` ne correspondrait pas à `étape`. D'où une
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
    fn every_known_language_is_accepted() {
        for language in LANGUAGES {
            assert!(validate_language(language).is_ok());
        }
    }

    #[test]
    fn an_unknown_language_is_refused_with_its_field() {
        let error = validate_language("rust").unwrap_err();

        assert_eq!(error.field, "language");
        assert!(error.detail.contains("rust"));
    }

    #[test]
    fn the_comparison_is_exact_rather_than_case_insensitive() {
        // The front sends the tag from a fixed list, never free text; accepting
        // "JSON" would put a second spelling of one language into the database.
        assert!(validate_language("JSON").is_err());
        assert!(validate_language("").is_err());
    }

    fn normalized(tags: &[&str]) -> Vec<String> {
        normalize_tags(&tags.iter().map(|tag| tag.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn padding_and_blanks_are_dropped() {
        assert_eq!(
            normalized(&["  urgent ", "", "   ", "later"]),
            ["urgent", "later"]
        );
    }

    #[test]
    fn a_duplicate_keeps_its_first_spelling() {
        assert_eq!(normalized(&["Urgent", "urgent", "URGENT"]), ["Urgent"]);
    }

    #[test]
    fn only_leading_hashes_are_stripped() {
        assert_eq!(normalized(&["##c++", "a#b"]), ["c++", "a#b"]);
    }

    #[test]
    fn a_tag_reduced_to_nothing_is_dropped_rather_than_stored_empty() {
        // " # " trims to "#", then to "" — storing that would put a blank facet
        // in the rail that selects every note carrying it.
        assert!(normalized(&[" # ", "#"]).is_empty());
    }

    #[test]
    fn tag_case_folding_reaches_beyond_ascii() {
        // SQLite's NOCASE would not collapse these; `to_lowercase` is Unicode.
        assert_eq!(normalized(&["Étape", "étape"]), ["Étape"]);
    }

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
