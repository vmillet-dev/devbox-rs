//! Regroupement des notes en sections d'affichage.
//!
//! ⚠️ **L'exhaustivité est une garantie.** Hors épinglées, chaque note tombe dans
//! exactement une section : une note sans section serait introuvable dans
//! l'interface, recherche comprise.

use chrono::{DateTime, Datelike, FixedOffset, TimeDelta, Utc};

use super::note::{self, DisplayNote, Note};
use super::view::{NoteSection, NoteSectionKey};

const A_WEEK: TimeDelta = TimeDelta::days(7);

/// Amplitude des fuseaux réels : UTC−12 à UTC+14.
const MAX_TZ_OFFSET_MINUTES: u32 = 14 * 60;

/// ⚠️ Le signe s'inverse : JavaScript compte les minutes à **ajouter** à l'heure
/// locale pour obtenir UTC (−120 pour UTC+2), chrono attend le décalage à l'est.
///
/// La borne est vérifiée **avant** la multiplication : la valeur vient du pont,
/// et `-i32::MIN` comme `i32::MAX * 60` déborderaient — d'où `unsigned_abs`.
pub fn offset_from_minutes(tz_offset_minutes: i32) -> FixedOffset {
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
        .map(|note| note::decorate(note, now))
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
pub fn build(
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
