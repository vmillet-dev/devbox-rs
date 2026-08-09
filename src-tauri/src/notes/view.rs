//! Ce que l'utilisateur demande à voir ([`NotesQuery`]) et ce que le canevas
//! affiche en retour ([`NotesView`]) : filtrage texte, regroupement en sections,
//! facettes.
//!
//! Aucun type intermédiaire « liste de notes » n'est exposé au front : il
//! inviterait à refiltrer côté interface.
//!
//! ⚠️ **L'exhaustivité des sections est une garantie.** Hors épinglées, chaque
//! note tombe dans exactement une section : une note sans section serait
//! introuvable dans l'interface, recherche comprise.

use chrono::{DateTime, Datelike, FixedOffset, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::language::Language;
use super::model::{self, DisplayNote, Note};

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
        notes.retain(|note| matches_search(note, &needle));
    }

    // Un filtre rapide restreint une vue qui reste chronologique ; une recherche
    // ou une facette, elle, bascule en liste plate.
    let is_filtering = !needle.is_empty()
        || !model::normalize_tags(&request.tags).is_empty()
        || !request.languages.is_empty();
    // Saturer vaut mieux que paniquer : ce compteur ne sert qu'à un libellé.
    let matched = u32::try_from(notes.len()).unwrap_or(u32::MAX);

    let offset = offset_from_minutes(request.tz_offset_minutes);

    NotesView {
        sections: build_sections(notes, is_filtering, request.now, offset),
        available_tags: facets.tags,
        available_languages: facets.languages,
        is_filtering,
        matched,
    }
}

/// `needle` est attendu **déjà replié en minuscules et détouré**.
///
/// ⚠️ Le repliage est en Rust et non en SQL : sans ICU, le `LOWER()` de SQLite ne
/// traite que l'ASCII, donc `Étape` ne correspondrait pas à `étape`. D'où une
/// recherche qui ne descend pas dans le `WHERE`, contrairement aux filtres
/// grossiers, qui eux y restent indexés.
fn matches_search(note: &Note, needle: &str) -> bool {
    note.title.to_lowercase().contains(needle)
        || note
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(needle))
        || note.content.to_lowercase().contains(needle)
}

const A_WEEK: TimeDelta = TimeDelta::days(7);

/// Amplitude des fuseaux réels : UTC−12 à UTC+14.
const MAX_TZ_OFFSET_MINUTES: u32 = 14 * 60;

/// ⚠️ Le signe s'inverse : JavaScript compte les minutes à **ajouter** à l'heure
/// locale pour obtenir UTC (−120 pour UTC+2), chrono attend le décalage à l'est.
///
/// La borne est vérifiée **avant** la multiplication : la valeur vient du pont,
/// et `-i32::MIN` comme `i32::MAX * 60` déborderaient — d'où `unsigned_abs`.
fn offset_from_minutes(tz_offset_minutes: i32) -> FixedOffset {
    let utc = FixedOffset::east_opt(0).expect("UTC est un décalage valide");

    if tz_offset_minutes.unsigned_abs() > MAX_TZ_OFFSET_MINUTES {
        return utc;
    }

    FixedOffset::east_opt(-tz_offset_minutes * 60).unwrap_or(utc)
}

fn is_same_local_day(a: &DateTime<FixedOffset>, b: &DateTime<FixedOffset>) -> bool {
    a.year() == b.year() && a.month() == b.month() && a.day() == b.day()
}

fn is_within(date: &DateTime<FixedOffset>, now: &DateTime<FixedOffset>, window: TimeDelta) -> bool {
    let elapsed = now.signed_duration_since(*date);
    elapsed >= TimeDelta::zero() && elapsed <= window
}

fn section(
    key: NoteSectionKey,
    notes: Vec<Note>,
    show_create_ghost: bool,
    now: DateTime<Utc>,
) -> NoteSection {
    let notes: Vec<DisplayNote> = notes
        .into_iter()
        .map(|note| model::decorate(note, now))
        .collect();

    NoteSection {
        has_expiring_notes: notes.iter().any(|note| note.expiring_soon),
        key,
        notes,
        show_create_ghost,
    }
}

/// Répartis par date, les résultats se diluent et semblent absents quand tout
/// tombe en bas de page.
fn results(notes: Vec<Note>, now: DateTime<Utc>) -> Vec<NoteSection> {
    vec![section(NoteSectionKey::Results, notes, false, now)]
}

/// `is_filtering` bascule en liste plate. L'ordre reçu est conservé dans chaque
/// section : c'est celui du tri SQL, et il fait autorité.
fn build_sections(
    notes: Vec<Note>,
    is_filtering: bool,
    now: DateTime<Utc>,
    offset: FixedOffset,
) -> Vec<NoteSection> {
    let local_now = now.with_timezone(&offset);
    if is_filtering {
        return results(notes, now);
    }

    let mut pinned = Vec::new();
    let mut today = Vec::new();
    let mut this_week = Vec::new();
    let mut older = Vec::new();

    for note in notes {
        if note.pinned {
            pinned.push(note);
            continue;
        }

        let created = note.created_at.with_timezone(&offset);
        if is_same_local_day(&created, &local_now) {
            today.push(note);
        } else if is_within(&created, &local_now, A_WEEK) {
            this_week.push(note);
        } else {
            older.push(note);
        }
    }

    let mut sections = Vec::new();

    if !pinned.is_empty() {
        sections.push(section(NoteSectionKey::Pinned, pinned, false, now));
    }
    if !today.is_empty() {
        sections.push(section(NoteSectionKey::Today, today, false, now));
    }

    // Toujours présente : c'est elle qui héberge la carte « coller ou créer ».
    sections.push(section(NoteSectionKey::Week, this_week, true, now));

    if !older.is_empty() {
        sections.push(section(NoteSectionKey::Older, older, false, now));
    }

    sections
}

#[cfg(test)]
mod tests;
