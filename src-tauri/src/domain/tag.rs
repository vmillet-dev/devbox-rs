//! Normalisation des tags.

/// Trim, `#` de tête, vides et doublons.
///
/// Règle unique : le front envoie ce que l'utilisateur a tapé, l'écriture comme
/// la requête passent par ici — sinon un `#urgent` saisi ne retrouverait pas le
/// `urgent` stocké. La déduplication est insensible à la casse et garde la
/// première graphie ; `COLLATE NOCASE` (migration 2) prolonge la règle au corpus.
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
        normalize(&tags.iter().copied().map(String::from).collect::<Vec<_>>())
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
}
