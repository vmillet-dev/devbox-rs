//! Regroupement des notes en sections d'affichage.
//!
//! Module **pur** : aucune connexion, aucune horloge lue en interne. Il ne
//! manipule que des notes déjà filtrées et un instant de référence, ce qui le
//! rend testable sans base et sans figer le temps.
//!
//! # L'exhaustivité est une garantie, pas un détail
//!
//! Hors notes épinglées, chaque note tombe dans **exactement une** section parmi
//! `today`, `week` et `older`. Une note n'appartenant à aucune section serait
//! introuvable dans l'interface, recherche comprise.

use chrono::{DateTime, Datelike, FixedOffset};

use crate::commands::notes::{Note, NoteSection, NoteSectionKey};

const WEEK_DAYS: i64 = 7;

/// Décalage du front (`Date#getTimezoneOffset()`) en `FixedOffset` chrono.
///
/// Le signe s'inverse : JavaScript compte les minutes à **ajouter** à l'heure
/// locale pour obtenir UTC (−120 pour UTC+2), là où chrono attend le décalage
/// à l'est de UTC. Une valeur aberrante retombe sur UTC plutôt que de faire
/// échouer la requête : au pire les journées sont découpées à l'heure UTC.
pub fn offset_from_minutes(tz_offset_minutes: i32) -> FixedOffset {
    FixedOffset::east_opt(-tz_offset_minutes * 60).unwrap_or_else(|| FixedOffset::east_opt(0).expect("UTC est un décalage valide"))
}

/// Une date ISO illisible ne doit pas faire disparaître la note : elle est
/// classée dans `older`, où elle reste atteignable. `created_at` vient de notre
/// propre écriture, donc le cas relève de la corruption, pas du fonctionnement.
fn parse(value: &str, offset: &FixedOffset) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(offset))
}

fn is_same_local_day(a: &DateTime<FixedOffset>, b: &DateTime<FixedOffset>) -> bool {
    a.year() == b.year() && a.month() == b.month() && a.day() == b.day()
}

fn is_within_days(date: &DateTime<FixedOffset>, now: &DateTime<FixedOffset>, days: i64) -> bool {
    let elapsed = now.signed_duration_since(*date);
    elapsed.num_milliseconds() >= 0 && elapsed.num_days() <= days
}

fn section(key: NoteSectionKey, notes: Vec<Note>, show_create_ghost: bool) -> NoteSection {
    NoteSection {
        has_expiring_notes: notes
            .iter()
            .any(|note| matches!(note.lifecycle, crate::commands::notes::NoteLifecycle::Expires { .. })),
        key,
        notes,
        show_create_ghost,
    }
}

/// Vue plate, utilisée dès qu'une recherche ou un filtre par tag est actif.
///
/// Répartir des résultats de recherche dans des sections de date les dilue et
/// laisse croire qu'il n'y a rien à voir quand tout est tombé dans une section
/// en bas de page. Un résultat de recherche se lit en liste.
fn results(notes: Vec<Note>) -> Vec<NoteSection> {
    vec![section(NoteSectionKey::Results, notes, false)]
}

/// Regroupe les notes en sections. `is_filtering` bascule en liste plate.
///
/// L'ordre reçu est conservé à l'intérieur de chaque section : c'est celui
/// décidé par le tri SQL, et il fait autorité.
pub fn build(
    notes: Vec<Note>,
    is_filtering: bool,
    now: &DateTime<FixedOffset>,
    offset: &FixedOffset,
) -> Vec<NoteSection> {
    if is_filtering {
        return results(notes);
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

        // Le `else` du `match` couvre à la fois « plus vieux qu'une semaine » et
        // « date illisible » : dans les deux cas la note atterrit dans `older`,
        // jamais nulle part.
        match parse(&note.created_at, offset) {
            Some(created) if is_same_local_day(&created, now) => today.push(note),
            Some(created) if is_within_days(&created, now, WEEK_DAYS) => this_week.push(note),
            _ => older.push(note),
        }
    }

    let mut sections = Vec::new();

    if !pinned.is_empty() {
        sections.push(section(NoteSectionKey::Pinned, pinned, false));
    }
    if !today.is_empty() {
        sections.push(section(NoteSectionKey::Today, today, false));
    }

    // Toujours présente : c'est elle qui héberge la carte « coller ou créer ».
    sections.push(section(NoteSectionKey::Week, this_week, true));

    if !older.is_empty() {
        sections.push(section(NoteSectionKey::Older, older, false));
    }

    sections
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::notes::NoteLifecycle;

    /// 25 July 2026, 09:00 UTC.
    const NOW: &str = "2026-07-25T09:00:00.000Z";

    fn utc() -> FixedOffset {
        FixedOffset::east_opt(0).unwrap()
    }

    fn now_at(offset: &FixedOffset) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(NOW).unwrap().with_timezone(offset)
    }

    fn note(id: &str, created_at: &str) -> Note {
        Note {
            id: id.to_string(),
            space_id: "s-1".to_string(),
            title: String::new(),
            language: "txt".to_string(),
            content: String::new(),
            source: String::new(),
            tags: Vec::new(),
            pinned: false,
            created_at: created_at.to_string(),
            updated_at: created_at.to_string(),
            lifecycle: NoteLifecycle::Permanent,
        }
    }

    fn keys(sections: &[NoteSection]) -> Vec<NoteSectionKey> {
        sections.iter().map(|section| section.key).collect()
    }

    fn ids_in(sections: &[NoteSection], key: NoteSectionKey) -> Vec<String> {
        sections
            .iter()
            .filter(|section| section.key == key)
            .flat_map(|section| section.notes.iter().map(|note| note.id.clone()))
            .collect()
    }

    #[test]
    fn every_unpinned_note_lands_in_exactly_one_section() {
        let offset = utc();
        let notes = vec![
            note("today", "2026-07-25T08:00:00.000Z"),
            note("week", "2026-07-21T08:00:00.000Z"),
            note("older", "2020-01-01T08:00:00.000Z"),
        ];

        let sections = build(notes, false, &now_at(&offset), &offset);

        // A note in no section would be unreachable in the UI, search included.
        let placed: Vec<String> = sections
            .iter()
            .flat_map(|section| section.notes.iter().map(|note| note.id.clone()))
            .collect();
        assert_eq!(placed.len(), 3);
        assert_eq!(ids_in(&sections, NoteSectionKey::Today), ["today"]);
        assert_eq!(ids_in(&sections, NoteSectionKey::Week), ["week"]);
        assert_eq!(ids_in(&sections, NoteSectionKey::Older), ["older"]);
    }

    #[test]
    fn the_week_section_is_present_even_when_empty() {
        let offset = utc();

        let sections = build(Vec::new(), false, &now_at(&offset), &offset);

        // It hosts the "paste or create" ghost card, so it cannot be dropped.
        assert_eq!(keys(&sections), [NoteSectionKey::Week]);
        assert!(sections[0].show_create_ghost);
    }

    #[test]
    fn only_the_week_section_carries_the_create_ghost() {
        let offset = utc();
        let notes = vec![
            note("today", "2026-07-25T08:00:00.000Z"),
            note("older", "2020-01-01T08:00:00.000Z"),
        ];

        let sections = build(notes, false, &now_at(&offset), &offset);

        let with_ghost: Vec<NoteSectionKey> = sections
            .iter()
            .filter(|section| section.show_create_ghost)
            .map(|section| section.key)
            .collect();
        assert_eq!(with_ghost, [NoteSectionKey::Week]);
    }

    #[test]
    fn pinned_notes_leave_the_chronological_sections() {
        let offset = utc();
        let mut pinned = note("pinned", "2026-07-25T08:00:00.000Z");
        pinned.pinned = true;

        let sections = build(vec![pinned], false, &now_at(&offset), &offset);

        assert_eq!(ids_in(&sections, NoteSectionKey::Pinned), ["pinned"]);
        assert!(ids_in(&sections, NoteSectionKey::Today).is_empty());
    }

    #[test]
    fn empty_sections_other_than_week_are_omitted() {
        let offset = utc();

        let sections = build(
            vec![note("today", "2026-07-25T08:00:00.000Z")],
            false,
            &now_at(&offset),
            &offset,
        );

        assert_eq!(keys(&sections), [NoteSectionKey::Today, NoteSectionKey::Week]);
    }

    #[test]
    fn filtering_collapses_everything_into_a_single_flat_section() {
        let offset = utc();
        let mut pinned = note("pinned", "2026-07-25T08:00:00.000Z");
        pinned.pinned = true;
        let notes = vec![pinned, note("ancient", "2019-05-05T08:00:00.000Z")];

        let sections = build(notes, true, &now_at(&offset), &offset);

        // Chronological grouping would bury an old match in a trailing section.
        assert_eq!(keys(&sections), [NoteSectionKey::Results]);
        assert_eq!(sections[0].notes.len(), 2);
        assert!(!sections[0].show_create_ghost);
    }

    #[test]
    fn a_section_reports_whether_any_of_its_notes_expires() {
        let offset = utc();
        let mut expiring = note("expiring", "2026-07-25T08:00:00.000Z");
        expiring.lifecycle = NoteLifecycle::Expires {
            at: "2026-08-01T00:00:00.000Z".to_string(),
        };

        let sections = build(
            vec![expiring, note("plain", "2026-07-25T08:00:00.000Z")],
            false,
            &now_at(&offset),
            &offset,
        );

        let today = sections.iter().find(|s| s.key == NoteSectionKey::Today).unwrap();
        assert!(today.has_expiring_notes);
        let week = sections.iter().find(|s| s.key == NoteSectionKey::Week).unwrap();
        assert!(!week.has_expiring_notes);
    }

    #[test]
    fn the_day_boundary_follows_the_local_timezone_not_utc() {
        // 23:30 in Paris on 25 July is already 21:30 UTC the same day, but a note
        // created at 22:10 UTC is 00:10 local on the 26th — tomorrow, not today.
        let paris = offset_from_minutes(-120);
        let now = DateTime::parse_from_rfc3339("2026-07-25T21:30:00.000Z")
            .unwrap()
            .with_timezone(&paris);

        let sections = build(
            vec![note("local-today", "2026-07-25T20:00:00.000Z")],
            false,
            &now,
            &paris,
        );

        assert_eq!(ids_in(&sections, NoteSectionKey::Today), ["local-today"]);
    }

    #[test]
    fn a_note_created_just_after_local_midnight_is_not_yesterday() {
        // Same instant read in UTC would fall on the previous day and land in
        // "this week" instead of "today".
        let paris = offset_from_minutes(-120);
        let now = DateTime::parse_from_rfc3339("2026-07-26T08:00:00.000Z")
            .unwrap()
            .with_timezone(&paris);

        let sections = build(
            vec![note("after-midnight", "2026-07-25T22:10:00.000Z")],
            false,
            &now,
            &paris,
        );

        assert_eq!(ids_in(&sections, NoteSectionKey::Today), ["after-midnight"]);
    }

    #[test]
    fn a_javascript_offset_is_inverted_into_a_chrono_offset() {
        // getTimezoneOffset() returns -120 for UTC+2: the opposite sign.
        assert_eq!(offset_from_minutes(-120).local_minus_utc(), 2 * 3600);
        assert_eq!(offset_from_minutes(300).local_minus_utc(), -5 * 3600);
    }

    #[test]
    fn an_unparsable_creation_date_keeps_the_note_reachable() {
        let offset = utc();

        let sections = build(vec![note("corrupt", "pas une date")], false, &now_at(&offset), &offset);

        assert_eq!(ids_in(&sections, NoteSectionKey::Older), ["corrupt"]);
    }

    #[test]
    fn a_note_created_in_the_future_is_not_swallowed() {
        let offset = utc();

        let sections = build(
            vec![note("future", "2030-01-01T00:00:00.000Z")],
            false,
            &now_at(&offset),
            &offset,
        );

        // is_within_days rejects negative elapsed time, so it must still surface
        // somewhere rather than vanish between the branches.
        assert_eq!(ids_in(&sections, NoteSectionKey::Older), ["future"]);
    }

    #[test]
    fn the_order_received_is_preserved_inside_a_section() {
        let offset = utc();
        let notes = vec![
            note("first", "2026-07-25T08:00:00.000Z"),
            note("second", "2026-07-25T07:00:00.000Z"),
        ];

        let sections = build(notes, false, &now_at(&offset), &offset);

        // The SQL ORDER BY decides; this module must not re-sort.
        assert_eq!(ids_in(&sections, NoteSectionKey::Today), ["first", "second"]);
    }
}
