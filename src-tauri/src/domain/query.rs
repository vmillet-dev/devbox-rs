//! Ce que l'utilisateur demande à voir, et ce que le canevas affiche en retour.
//!
//! [`NotesQuery`] décrit une intention, [`NotesView`] une réponse **prête à
//! afficher**. Il n'existe volontairement pas de type intermédiaire « liste de
//! notes » exposé au front : il inviterait à refiltrer côté interface.

use serde::{Deserialize, Serialize};

use super::display::DisplayNote;

/// Ce que l'utilisateur a demandé à voir. Tout y est explicite : la requête ne
/// lit ni horloge ni fuseau, ce qui la rend reproductible en test.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesQuery {
    /// `None` = « tous les espaces ». Ce n'est pas une absence de choix mais un
    /// choix : il n'existe aucun espace « Tous » côté données.
    pub space_id: Option<String>,
    /// Texte recherché dans le titre, les tags et le contenu. Vide = pas de recherche.
    pub search: String,
    pub filter: NoteFilter,
    /// Tags sélectionnés dans le rail. Une note passe si elle en porte **au
    /// moins un** (et non tous) : c'est le comportement d'un rail de facettes.
    pub tags: Vec<String>,
    /// Instant de référence, ISO 8601 UTC — fourni par `ClockService` côté front.
    pub now: String,
    /// `Date#getTimezoneOffset()` du front. Nécessaire parce que les sections
    /// raisonnent en **jours locaux** : à 23 h à Paris, `now` en UTC est déjà
    /// demain, et une note d'aujourd'hui tomberait dans « cette semaine ».
    ///
    /// ⚠️ Convention JavaScript : la valeur est l'opposé du décalage. UTC+2
    /// donne −120, d'où le `-` dans la conversion en `FixedOffset`.
    pub tz_offset_minutes: i32,
}

/// Filtre rapide de la barre d'outils. `Untriaged` = notes portant une date
/// d'expiration : une note éphémère est précisément celle dont on n'a pas encore
/// décidé du sort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteFilter {
    All,
    Pinned,
    Untriaged,
}

/// Ce que le canevas affiche, tel quel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesView {
    pub sections: Vec<NoteSection>,
    /// Tags proposés par le rail. Portée à l'**espace**, pas au filtre courant :
    /// n'afficher que les tags des notes déjà filtrées rendrait le rail
    /// inutilisable dès la première sélection.
    pub available_tags: Vec<String>,
    /// Une recherche ou une sélection de tags est active. Le front s'en sert
    /// pour distinguer « aucun résultat » d'« espace vide ».
    pub is_filtering: bool,
    /// Nombre de notes retenues, toutes sections confondues.
    pub matched: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSection {
    pub key: NoteSectionKey,
    pub notes: Vec<DisplayNote>,
    /// Au moins une note de la section arrive à échéance — au sens du seuil
    /// unique de `display`, celui que le libellé « à trier bientôt » promet.
    pub has_expiring_notes: bool,
    /// Affiche la carte fantôme « coller ou créer » à la fin de la section.
    pub show_create_ghost: bool,
}

/// Sert de **clé de traduction** côté front (`sections.<key>`) : c'est pourquoi
/// aucun libellé lisible ne traverse le pont.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteSectionKey {
    Pinned,
    Today,
    Week,
    Older,
    Results,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::display;
    use crate::domain::fixtures::note as sample;

    fn displayed() -> DisplayNote {
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-25T09:00:00.000Z").unwrap();
        display::decorate(sample(), &now)
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
            is_filtering: false,
            matched: 1,
        };

        let json = serde_json::to_value(view).unwrap();

        assert!(json.get("availableTags").is_some());
        assert!(json.get("isFiltering").is_some());
        assert!(json.get("available_tags").is_none());
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
            "now": "2026-07-25T09:00:00.000Z",
            "tzOffsetMinutes": -120
        }))
        .unwrap();

        assert_eq!(query.space_id.as_deref(), Some("s-1"));
        assert_eq!(query.filter, NoteFilter::Untriaged);
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
            "now": "2026-07-25T09:00:00.000Z",
            "tzOffsetMinutes": 0
        }))
        .unwrap();

        assert!(query.space_id.is_none());
    }
}
