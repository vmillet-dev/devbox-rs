//! Normalisation des tags.
//!
//! Règle unique et sans dépendance : le front envoie ce que l'utilisateur a
//! tapé, la persistance écrit ce que cette fonction renvoie, et la requête fait
//! passer les tags sélectionnés par la même moulinette — sinon un `#urgent`
//! saisi au clavier ne retrouverait pas le tag `urgent` stocké.

/// Nettoie les tags : espaces, `#` de tête, vides et doublons.
///
/// La déduplication est **insensible à la casse** et garde la première graphie
/// rencontrée. Sans elle, `urgent` et `URGENT` produiraient deux entrées dans le
/// rail alors qu'ils désignent la même chose pour l'utilisateur. Le stockage
/// prolonge cette règle à tout le corpus via `COLLATE NOCASE` (migration 2).
pub fn normalize(tags: &[String]) -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn normalized(tags: &[&str]) -> Vec<String> {
        normalize(&tags.iter().map(|tag| tag.to_string()).collect::<Vec<_>>())
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
    fn case_folding_reaches_beyond_ascii() {
        // SQLite's NOCASE would not collapse these; `to_lowercase` is Unicode.
        assert_eq!(normalized(&["Étape", "étape"]), ["Étape"]);
    }
}
