//! Langages reconnus pour la coloration d'une note.
//!
//! Cette liste est **la** référence : le front en a un miroir
//! (`src/app/core/models/language.model.ts`) pour peupler son sélecteur et pour
//! dégrader vers `txt` ce qu'une version plus récente du back lui enverrait.
//! Mais c'est ici que l'écriture est refusée — sinon une valeur arbitraire
//! finirait en base, et plus aucune version du front ne saurait l'afficher.

use super::validation::ValidationError;

pub const LANGUAGES: [&str; 6] = ["json", "js", "py", "sql", "yml", "txt"];

pub fn validate(language: &str) -> Result<(), ValidationError> {
    if LANGUAGES.contains(&language) {
        return Ok(());
    }

    Err(ValidationError::new(
        "language",
        format!("« {language} » n'est pas un langage reconnu"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_known_language_is_accepted() {
        for language in LANGUAGES {
            assert!(validate(language).is_ok());
        }
    }

    #[test]
    fn an_unknown_language_is_refused_with_its_field() {
        let error = validate("rust").unwrap_err();

        assert_eq!(error.field, "language");
        assert!(error.detail.contains("rust"));
    }

    #[test]
    fn the_comparison_is_exact_rather_than_case_insensitive() {
        // The front sends the tag from a fixed list, never free text; accepting
        // "JSON" would put a second spelling of one language into the database.
        assert!(validate("JSON").is_err());
        assert!(validate("").is_err());
    }
}
