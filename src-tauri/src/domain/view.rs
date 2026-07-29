//! Ce que l'utilisateur demande à voir ([`NotesQuery`]), ce que le canevas
//! affiche en retour ([`NotesView`]), et l'assemblage de l'un vers l'autre.
//!
//! Aucun type intermédiaire « liste de notes » n'est exposé au front : il
//! inviterait à refiltrer côté interface.
//!
//! [`build`] est pure — elle reçoit les notes que le SQL a dégrossies et n'ouvre
//! aucune connexion. Le partage : **SQL** pour ce qu'il indexe (espace,
//! épinglage, cycle de vie, langage, tag), **ici** pour la recherche texte qui
//! demande un repliage Unicode, [`super::sections`] pour le regroupement.

use chrono::DateTime;

use serde::{Deserialize, Serialize};

use super::note::{DisplayNote, Note};
use super::rules::{self, ValidationError};
use super::sections;

/// Tout y est explicite : la requête ne lit ni horloge ni fuseau, ce qui la
/// rend reproductible en test.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesQuery {
    /// `None` = « tous les espaces » — un choix, pas une absence de choix : il
    /// n'existe aucun espace « Tous » côté données.
    pub space_id: Option<String>,
    /// Cherché dans le titre, les tags et le contenu. Vide = pas de recherche.
    pub search: String,
    pub filter: NoteFilter,
    /// Tags du rail. Une note passe si elle en porte **au moins un**.
    pub tags: Vec<String>,
    /// Langages du rail, même sémantique d'union. Vide = tous.
    pub languages: Vec<String>,
    /// Instant de référence ISO 8601 UTC, fourni par `ClockService`.
    pub now: String,
    /// ⚠️ `Date#getTimezoneOffset()`, dont la valeur est l'**opposé** du décalage
    /// (UTC+2 donne −120). Nécessaire parce que les sections raisonnent en jours
    /// locaux : à 23 h à Paris, `now` en UTC est déjà demain.
    pub tz_offset_minutes: i32,
}

/// Filtre rapide de la barre d'outils. `Untriaged` = notes portant une date
/// d'expiration, c'est-à-dire celles dont on n'a pas encore décidé du sort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteFilter {
    All,
    Pinned,
    Untriaged,
}

/// Ce que les rails ont à proposer. Regroupées parce que la persistance les
/// calcule ensemble ; ne traverse pas le pont.
#[derive(Debug, Clone, Default)]
pub struct Facets {
    pub tags: Vec<String>,
    pub languages: Vec<String>,
}

/// Ce que le canevas affiche, tel quel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesView {
    pub sections: Vec<NoteSection>,
    /// Portés à l'**espace**, pas au filtre courant : n'afficher que les tags des
    /// notes déjà filtrées rendrait le rail inutilisable dès la 1re sélection.
    pub available_tags: Vec<String>,
    /// Portés à l'espace, même raison.
    pub available_languages: Vec<String>,
    /// Une recherche ou une facette est active. Le front distingue ainsi
    /// « aucun résultat » d'« espace vide ».
    pub is_filtering: bool,
    /// Notes retenues, toutes sections confondues.
    pub matched: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSection {
    pub key: NoteSectionKey,
    /// Au moins une note arrive à échéance, au sens du seuil unique de `note`.
    pub has_expiring_notes: bool,
    pub notes: Vec<DisplayNote>,
    /// Affiche la carte fantôme « coller ou créer » en fin de section.
    pub show_create_ghost: bool,
}

/// Sert de **clé de traduction** côté front (`sections.<key>`) : aucun libellé
/// lisible ne traverse le pont.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteSectionKey {
    Pinned,
    Today,
    Week,
    Older,
    Results,
}

/// Vue complète. Une vue vide est une réponse valide (premier lancement, ou
/// recherche infructueuse — `is_filtering` distingue les deux).
///
/// Un `now` illisible est **refusé**, jamais remplacé par l'horloge du serveur :
/// un repli muet ferait basculer tout le découpage sur un autre instant.
pub fn build(
    notes: Vec<Note>,
    facets: Facets,
    request: &NotesQuery,
) -> Result<NotesView, ValidationError> {
    let mut notes = notes;

    // La recherche porte aussi sur les tags, déjà rattachés par la persistance.
    let needle = request.search.trim().to_lowercase();
    if !needle.is_empty() {
        notes.retain(|note| rules::matches(note, &needle));
    }

    // Le filtre rapide (épinglées / à trier) ne bascule pas en mode résultats :
    // il restreint une vue qui reste chronologique. Une recherche ou une
    // facette — tag ou langage —, si.
    let is_filtering = !needle.is_empty()
        || !rules::normalize_tags(&request.tags).is_empty()
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
    use super::build as try_build;
    use super::*;
    use crate::domain::fixtures::note as sample;
    use crate::domain::note::decorate;

    const NOW: &str = "2026-07-25T09:00:00.000Z";

    fn displayed() -> DisplayNote {
        let now = DateTime::parse_from_rfc3339(NOW).unwrap();
        decorate(sample(), &now)
    }

    #[test]
    fn a_view_serialises_with_camel_case_keys() {
        let view = NotesView {
            sections: vec![NoteSection {
                key: NoteSectionKey::Week,
                notes: vec![displayed()],
                has_expiring_notes: false,
                show_create_ghost: true,
            }],
            available_tags: vec!["auth".to_string()],
            available_languages: vec!["json".to_string()],
            is_filtering: false,
            matched: 1,
        };

        let json = serde_json::to_value(view).unwrap();

        assert!(json.get("availableTags").is_some());
        assert!(json.get("availableLanguages").is_some());
        assert!(json.get("isFiltering").is_some());
        assert!(json.get("available_tags").is_none());
        assert!(json.get("available_languages").is_none());
        assert!(json["sections"][0].get("hasExpiringNotes").is_some());
        assert!(json["sections"][0].get("showCreateGhost").is_some());
    }

    #[test]
    fn a_section_key_serialises_as_the_translation_key_the_front_expects() {
        let section = NoteSection {
            key: NoteSectionKey::Older,
            notes: Vec::new(),
            has_expiring_notes: false,
            show_create_ghost: false,
        };

        let json = serde_json::to_value(section).unwrap();

        // The front builds `sections.older` from this; serde's default would
        // emit "Older" and the lookup would miss.
        assert_eq!(json["key"], "older");
    }

    #[test]
    fn a_query_is_read_from_the_camel_case_payload_the_front_sends() {
        let query: NotesQuery = serde_json::from_value(serde_json::json!({
            "spaceId": "s-1",
            "search": "deploy",
            "filter": "untriaged",
            "tags": ["urgent"],
            "languages": ["json", "yml"],
            "now": "2026-07-25T09:00:00.000Z",
            "tzOffsetMinutes": -120
        }))
        .unwrap();

        assert_eq!(query.space_id.as_deref(), Some("s-1"));
        assert_eq!(query.filter, NoteFilter::Untriaged);
        assert_eq!(query.languages, ["json", "yml"]);
        assert_eq!(query.tz_offset_minutes, -120);
    }

    #[test]
    fn a_null_space_is_read_as_every_space() {
        // The front sends null, not an omitted key, when the user picks
        // "all spaces" — that is a choice, not a missing value.
        let query: NotesQuery = serde_json::from_value(serde_json::json!({
            "spaceId": null,
            "search": "",
            "filter": "all",
            "tags": [],
            "languages": [],
            "now": "2026-07-25T09:00:00.000Z",
            "tzOffsetMinutes": 0
        }))
        .unwrap();

        assert!(query.space_id.is_none());
    }

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
