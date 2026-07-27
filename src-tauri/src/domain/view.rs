//! Assemblage de la vue renvoyée au canevas.
//!
//! Fonction **pure** : elle reçoit les notes que le SQL a déjà dégrossies et
//! n'ouvre aucune connexion. C'est ici que vivent les décisions que la
//! persistance n'a pas à connaître — ce qui compte comme une correspondance,
//! ce qui vaut « une recherche est en cours », et comment tout cela se range.
//!
//! # Le partage des tâches
//!
//! - **SQL** pour ce qu'il indexe bien : espace, épinglage, cycle de vie,
//!   langage, et l'appartenance à un tag via `note_tags` (voir
//!   `storage::notes::fetch`) ;
//! - **ici** pour la recherche texte, qui demande un repliage de casse Unicode
//!   (voir [`super::search`]) ;
//! - [`super::sections`] pour le regroupement.

use chrono::DateTime;

use super::note::Note;
use super::query::{Facets, NotesQuery, NotesView};
use super::validation::ValidationError;
use super::{search, sections, tags};

/// Vue complète : notes retenues, réparties en sections, plus les tags du rail.
///
/// Une vue sans aucune note est une réponse valide (premier lancement, ou
/// recherche infructueuse — `is_filtering` permet de distinguer les deux).
///
/// Un `now` illisible est **refusé** et non remplacé par l'horloge du serveur :
/// un repli muet ferait basculer tout le découpage en sections sur un autre
/// instant, et les notes changeraient de jour sans que rien ne le signale.
pub fn build(
    notes: Vec<Note>,
    facets: Facets,
    request: &NotesQuery,
) -> Result<NotesView, ValidationError> {
    let mut notes = notes;

    // La recherche porte aussi sur les tags, déjà rattachés par la persistance.
    let needle = request.search.trim().to_lowercase();
    if !needle.is_empty() {
        notes.retain(|note| search::matches(note, &needle));
    }

    // Le filtre rapide (épinglées / à trier) ne bascule pas en mode résultats :
    // il restreint une vue qui reste chronologique. Une recherche ou une
    // sélection de facettes — tag ou langage —, si.
    let is_filtering = !needle.is_empty()
        || !tags::normalize(&request.tags).is_empty()
        || !request.languages.is_empty();
    let matched = notes.len();

    let offset = sections::offset_from_minutes(request.tz_offset_minutes);
    let now = DateTime::parse_from_rfc3339(&request.now)
        .map_err(|_| {
            ValidationError::new(
                "now",
                format!("« {} » n'est pas un instant ISO 8601", request.now),
            )
        })?
        .with_timezone(&offset);

    Ok(NotesView {
        sections: sections::build(notes, is_filtering, &now, &offset),
        available_tags: facets.tags,
        available_languages: facets.languages,
        is_filtering,
        matched,
    })
}

#[cfg(test)]
mod tests {
    use super::super::query::{NoteFilter, NoteSectionKey};
    use super::build as try_build;
    use super::*;
    use crate::domain::fixtures::note as sample;

    const NOW: &str = "2026-07-25T09:00:00.000Z";

    /// Les cas nominaux fournissent tous un instant valide ; seul le test dédié
    /// s'intéresse au refus.
    fn build(notes: Vec<Note>, facets: Facets, request: &NotesQuery) -> NotesView {
        try_build(notes, facets, request).unwrap()
    }

    fn request() -> NotesQuery {
        NotesQuery {
            space_id: None,
            search: String::new(),
            filter: NoteFilter::All,
            tags: Vec::new(),
            languages: Vec::new(),
            now: NOW.to_string(),
            tz_offset_minutes: 0,
        }
    }

    fn note(id: &str, title: &str) -> Note {
        Note {
            id: id.to_string(),
            title: title.to_string(),
            created_at: "2026-07-25T08:00:00.000Z".to_string(),
            ..sample()
        }
    }

    fn keys(view: &NotesView) -> Vec<NoteSectionKey> {
        view.sections.iter().map(|section| section.key).collect()
    }

    #[test]
    fn an_empty_search_keeps_every_note_and_reports_no_filtering() {
        let view = build(
            vec![note("a", "Un"), note("b", "Deux")],
            Facets::default(),
            &request(),
        );

        assert_eq!(view.matched, 2);
        assert!(!view.is_filtering);
        assert_eq!(keys(&view), [NoteSectionKey::Today, NoteSectionKey::Week]);
    }

    #[test]
    fn a_search_narrows_the_notes_and_collapses_the_sections() {
        let notes = vec![note("a", "Déploiement"), note("b", "Autre chose")];

        let view = build(
            notes,
            Facets::default(),
            &NotesQuery {
                search: "  DÉPLOI  ".to_string(),
                ..request()
            },
        );

        // Trimmed and case-folded before matching, then flattened: a search
        // result reads as a list, not as date buckets.
        assert_eq!(view.matched, 1);
        assert!(view.is_filtering);
        assert_eq!(keys(&view), [NoteSectionKey::Results]);
    }

    #[test]
    fn a_selected_tag_counts_as_filtering_even_with_no_search() {
        let view = build(
            vec![note("a", "Un")],
            Facets::default(),
            &NotesQuery {
                tags: vec!["urgent".to_string()],
                ..request()
            },
        );

        assert!(view.is_filtering);
        assert_eq!(keys(&view), [NoteSectionKey::Results]);
    }

    #[test]
    fn a_tag_that_normalises_to_nothing_does_not_count_as_filtering() {
        // " # " is not a selection; treating it as one would flatten the canvas
        // and tell the user a search is running when none is.
        let view = build(
            vec![note("a", "Un")],
            Facets::default(),
            &NotesQuery {
                tags: vec![" # ".to_string()],
                ..request()
            },
        );

        assert!(!view.is_filtering);
    }

    #[test]
    fn a_fruitless_search_reports_filtering_with_zero_matches() {
        // The front tells "no result" from "empty space" on exactly this pair.
        let view = build(
            vec![note("a", "Un")],
            Facets::default(),
            &NotesQuery {
                search: "introuvable".to_string(),
                ..request()
            },
        );

        assert_eq!(view.matched, 0);
        assert!(view.is_filtering);
    }

    #[test]
    fn the_rail_facets_are_passed_through_untouched() {
        // They are scoped to the space by the query, not to the current search:
        // narrowing them would empty the rails on the first selection.
        let view = build(
            vec![note("a", "Un")],
            Facets {
                tags: vec!["api".to_string(), "auth".to_string()],
                languages: vec!["json".to_string(), "txt".to_string()],
            },
            &NotesQuery {
                search: "introuvable".to_string(),
                ..request()
            },
        );

        assert_eq!(view.available_tags, ["api", "auth"]);
        assert_eq!(view.available_languages, ["json", "txt"]);
    }

    #[test]
    fn a_selected_language_counts_as_filtering_like_a_selected_tag() {
        // Both rails are facet rails: selecting in either one turns the canvas
        // into a flat result list. Only the quick filters keep the date buckets.
        let view = build(
            vec![note("a", "Un")],
            Facets::default(),
            &NotesQuery {
                languages: vec!["json".to_string()],
                ..request()
            },
        );

        assert!(view.is_filtering);
        assert_eq!(keys(&view), [NoteSectionKey::Results]);
    }

    #[test]
    fn an_unreadable_reference_instant_is_refused_rather_than_replaced() {
        // Falling back to the server clock would silently re-cut every section
        // on another instant: notes would change day with nothing to show for it.
        let error = try_build(
            vec![note("a", "Un")],
            Facets::default(),
            &NotesQuery {
                now: "hier".to_string(),
                ..request()
            },
        )
        .unwrap_err();

        assert_eq!(error.field, "now");
    }
}
