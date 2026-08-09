use super::*;
use crate::domain::iso8601;
use crate::domain::language::Language;

fn at(iso: &str) -> DateTime<Utc> {
    iso8601::parse(iso).expect("les tests écrivent des instants valides")
}
use crate::domain::note::NoteLifecycle;

/// 25 July 2026, 09:00 UTC.
const NOW: &str = "2026-07-25T09:00:00.000Z";

fn utc() -> FixedOffset {
    FixedOffset::east_opt(0).unwrap()
}

fn now_at(_offset: FixedOffset) -> DateTime<Utc> {
    at(NOW)
}

#[test]
fn a_real_offset_keeps_its_sign_inverted() {
    // JavaScript reports -120 for UTC+2 and 300 for UTC-5.
    assert_eq!(offset_from_minutes(-120).local_minus_utc(), 2 * 3600);
    assert_eq!(offset_from_minutes(300).local_minus_utc(), -5 * 3600);
    assert_eq!(offset_from_minutes(0).local_minus_utc(), 0);
}

#[test]
fn an_absurd_offset_falls_back_to_utc_without_overflowing() {
    // The value crosses the IPC bridge unvalidated. Negating i32::MIN or
    // multiplying i32::MAX by 60 overflows, which panics in debug while the
    // connection mutex is held — poisoning it for the rest of the process.
    for absurd in [i32::MIN, i32::MAX, -100_000, 100_000, 841, -841] {
        assert_eq!(offset_from_minutes(absurd).local_minus_utc(), 0);
    }
}

fn note(id: &str, created_at: &str) -> Note {
    Note {
        id: id.to_string(),
        space_id: "s-1".to_string(),
        title: String::new(),
        language: Language::Txt,
        content: String::new(),
        source: String::new(),
        tags: Vec::new(),
        pinned: false,
        created_at: at(created_at),
        updated_at: at(created_at),
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

    let sections = build(notes, false, now_at(offset), offset);

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

    let sections = build(Vec::new(), false, now_at(offset), offset);

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

    let sections = build(notes, false, now_at(offset), offset);

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

    let sections = build(vec![pinned], false, now_at(offset), offset);

    assert_eq!(ids_in(&sections, NoteSectionKey::Pinned), ["pinned"]);
    assert!(ids_in(&sections, NoteSectionKey::Today).is_empty());
}

#[test]
fn empty_sections_other_than_week_are_omitted() {
    let offset = utc();

    let sections = build(
        vec![note("today", "2026-07-25T08:00:00.000Z")],
        false,
        now_at(offset),
        offset,
    );

    assert_eq!(
        keys(&sections),
        [NoteSectionKey::Today, NoteSectionKey::Week]
    );
}

#[test]
fn filtering_collapses_everything_into_a_single_flat_section() {
    let offset = utc();
    let mut pinned = note("pinned", "2026-07-25T08:00:00.000Z");
    pinned.pinned = true;
    let notes = vec![pinned, note("ancient", "2019-05-05T08:00:00.000Z")];

    let sections = build(notes, true, now_at(offset), offset);

    // Chronological grouping would bury an old match in a trailing section.
    assert_eq!(keys(&sections), [NoteSectionKey::Results]);
    assert_eq!(sections[0].notes.len(), 2);
    assert!(!sections[0].show_create_ghost);
}

#[test]
fn a_section_reports_whether_any_of_its_notes_is_due_soon() {
    let offset = utc();
    let mut expiring = note("expiring", "2026-07-25T08:00:00.000Z");
    expiring.lifecycle = NoteLifecycle::Expires {
        at: at("2026-07-26T00:00:00.000Z"),
    };

    let sections = build(
        vec![expiring, note("plain", "2026-07-25T08:00:00.000Z")],
        false,
        now_at(offset),
        offset,
    );

    let today = sections
        .iter()
        .find(|s| s.key == NoteSectionKey::Today)
        .unwrap();
    assert!(today.has_expiring_notes);
    let week = sections
        .iter()
        .find(|s| s.key == NoteSectionKey::Week)
        .unwrap();
    assert!(!week.has_expiring_notes);
}

#[test]
fn a_distant_deadline_does_not_light_up_the_section_hint() {
    let offset = utc();
    let mut expiring = note("expiring", "2026-07-25T08:00:00.000Z");
    expiring.lifecycle = NoteLifecycle::Expires {
        at: at("2027-01-01T00:00:00.000Z"),
    };

    let sections = build(vec![expiring], false, now_at(offset), offset);

    // The hint reads "to triage soon"; firing it six months ahead would make
    // it permanent background noise.
    let today = sections
        .iter()
        .find(|s| s.key == NoteSectionKey::Today)
        .unwrap();
    assert!(!today.has_expiring_notes);
}

#[test]
fn the_day_boundary_follows_the_local_timezone_not_utc() {
    // 23:30 in Paris on 25 July is already 21:30 UTC the same day, but a note
    // created at 22:10 UTC is 00:10 local on the 26th — tomorrow, not today.
    let paris = offset_from_minutes(-120);
    let now = at("2026-07-25T21:30:00.000Z");

    let sections = build(
        vec![note("local-today", "2026-07-25T20:00:00.000Z")],
        false,
        now,
        paris,
    );

    assert_eq!(ids_in(&sections, NoteSectionKey::Today), ["local-today"]);
}

#[test]
fn a_note_created_just_after_local_midnight_is_not_yesterday() {
    // Same instant read in UTC would fall on the previous day and land in
    // "this week" instead of "today".
    let paris = offset_from_minutes(-120);
    let now = at("2026-07-26T08:00:00.000Z");

    let sections = build(
        vec![note("after-midnight", "2026-07-25T22:10:00.000Z")],
        false,
        now,
        paris,
    );

    assert_eq!(ids_in(&sections, NoteSectionKey::Today), ["after-midnight"]);
}

#[test]
fn a_note_created_in_the_future_is_not_swallowed() {
    let offset = utc();

    let sections = build(
        vec![note("future", "2030-01-01T00:00:00.000Z")],
        false,
        now_at(offset),
        offset,
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

    let sections = build(notes, false, now_at(offset), offset);

    // The SQL ORDER BY decides; this module must not re-sort.
    assert_eq!(
        ids_in(&sections, NoteSectionKey::Today),
        ["first", "second"]
    );
}
