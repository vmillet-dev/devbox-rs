//! Ce que l'utilisateur demande à voir ([`NotesQuery`]) et ce que le canevas
//! affiche en retour ([`NotesView`]).
//!
//! Aucun type intermédiaire « liste de notes » n'est exposé au front : il
//! inviterait à refiltrer côté interface.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::language::Language;
use super::note::{DisplayNote, Note};
use super::{search, section, tag};

/// Ni horloge ni fuseau lus ici : tout est explicite, donc reproductible en test.
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotesQuery {
    /// `None` = « tous les espaces » — un choix, pas une absence de choix : il
    /// n'existe aucun espace « Tous » côté données.
    pub space_id: Option<String>,
    /// Vide = pas de recherche.
    pub search: String,
    pub filter: NoteFilter,
    /// Une note passe si elle porte **au moins un** de ces tags.
    pub tags: Vec<String>,
    /// Même sémantique d'union. Vide = tous.
    pub languages: Vec<Language>,
    pub now: DateTime<Utc>,
    /// ⚠️ `Date#getTimezoneOffset()`, dont la valeur est l'**opposé** du décalage
    /// (UTC+2 donne −120). Les sections raisonnent en jours locaux : à 23 h à
    /// Paris, `now` en UTC est déjà demain.
    pub tz_offset_minutes: i32,
}

/// `Untriaged` = notes portant une échéance, celles dont le sort n'est pas décidé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NoteFilter {
    All,
    Pinned,
    Untriaged,
}

/// Ce que les rails ont à proposer. Ne traverse pas le pont.
#[derive(Debug, Clone, Default)]
pub struct Facets {
    pub tags: Vec<String>,
    pub languages: Vec<Language>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotesView {
    pub sections: Vec<NoteSection>,
    /// Portées à l'**espace**, pas au filtre courant : n'offrir que les facettes
    /// des notes déjà filtrées viderait le rail dès la 1re sélection.
    pub available_tags: Vec<String>,
    pub available_languages: Vec<Language>,
    /// Distingue « aucun résultat » d'« espace vide ».
    pub is_filtering: bool,
    /// `u32` et non `usize` : Specta refuse d'exporter un type de la taille d'un
    /// `BigInt`, que JSON ne rend pas sans perte de précision.
    pub matched: u32,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteSection {
    pub key: NoteSectionKey,
    pub has_expiring_notes: bool,
    pub notes: Vec<DisplayNote>,
    pub show_create_ghost: bool,
}

/// **Clé de traduction** côté front (`sections.<key>`) : aucun libellé lisible
/// ne traverse le pont.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NoteSectionKey {
    Pinned,
    Today,
    Week,
    Older,
    Results,
}

/// Une vue vide est une réponse valide : premier lancement, ou recherche
/// infructueuse — `is_filtering` distingue les deux.
pub fn build(notes: Vec<Note>, facets: Facets, request: &NotesQuery) -> NotesView {
    let mut notes = notes;

    let needle = request.search.trim().to_lowercase();
    if !needle.is_empty() {
        notes.retain(|note| search::matches(note, &needle));
    }

    // Un filtre rapide restreint une vue qui reste chronologique ; une recherche
    // ou une facette, elle, bascule en liste plate.
    let is_filtering = !needle.is_empty()
        || !tag::normalize(&request.tags).is_empty()
        || !request.languages.is_empty();
    // Saturer vaut mieux que paniquer : ce compteur ne sert qu'à un libellé.
    let matched = u32::try_from(notes.len()).unwrap_or(u32::MAX);

    let offset = section::offset_from_minutes(request.tz_offset_minutes);

    NotesView {
        sections: section::build(notes, is_filtering, request.now, offset),
        available_tags: facets.tags,
        available_languages: facets.languages,
        is_filtering,
        matched,
    }
}

#[cfg(test)]
mod tests;
