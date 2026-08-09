//! What the user asks to see ([`NotesQuery`]) and what the canvas
//! displays in return ([`NotesView`]): text filtering, grouping into sections,
//! facets.
//!
//! No intermediate "note list" type is exposed to the front end: it
//! would invite re-filtering on the interface side.
//!
//! ⚠️ **Exhaustiveness of sections is a guarantee.** Outside of pinned ones, each
//! note falls into exactly one section: a note without a section would be
//! unreachable in the interface, including search.

use chrono::{DateTime, Datelike, FixedOffset, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::language::Language;
use super::model::{self, DisplayNote, Note};

/// Neither clock nor time zone read here: everything is explicit, thus reproducible in tests.
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotesQuery {
    /// `None` = "all spaces" — a choice, not an absence of choice: there
    /// is no "All" space on the data side.
    pub space_id: Option<String>,
    /// Empty = no search.
    pub search: String,
    pub filter: NoteFilter,
    /// A note passes if it carries **at least one** of these tags.
    pub tags: Vec<String>,
    /// Same union semantics. Empty = all.
    pub languages: Vec<Language>,
    pub now: DateTime<Utc>,
    /// ⚠️ `Date#getTimezoneOffset()`, whose value is the **opposite** of the offset
    /// (UTC+2 gives −120). Sections reason in local days: at 11 PM in
    /// Paris, `now` in UTC is already tomorrow.
    pub tz_offset_minutes: i32,
}

/// `Untriaged` = notes with a deadline, those whose fate is not decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NoteFilter {
    All,
    Pinned,
    Untriaged,
}

/// What the rails have to offer. Does not cross the bridge.
#[derive(Debug, Clone, Default)]
pub struct Facets {
    pub tags: Vec<String>,
    pub languages: Vec<Language>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotesView {
    pub sections: Vec<NoteSection>,
    /// Attached to the **space**, not the current filter: only offering facets
    /// from already filtered notes would empty the rail upon the 1st selection.
    pub available_tags: Vec<String>,
    pub available_languages: Vec<Language>,
    /// Distinguishes "no result" from "empty space".
    pub is_filtering: bool,
    /// `u32` and not `usize`: Specta refuses to export a type the size of a
    /// `BigInt`, which JSON does not render without loss of precision.
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

/// **Translation key** on the front-end side (`sections.<key>`): no readable label
/// crosses the bridge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NoteSectionKey {
    Pinned,
    Today,
    Week,
    Older,
    Results,
}

/// An empty view is a valid response: first launch, or unsuccessful
/// search — `is_filtering` distinguishes the two.
pub fn build(notes: Vec<Note>, facets: Facets, request: &NotesQuery) -> NotesView {
    let mut notes = notes;

    let needle = request.search.trim().to_lowercase();
    if !needle.is_empty() {
        notes.retain(|note| matches_search(note, &needle));
    }

    // A quick filter restricts a view that remains chronological; a search
    // or a facet, on the other hand, switches to a flat list.
    let is_filtering = !needle.is_empty()
        || !model::normalize_tags(&request.tags).is_empty()
        || !request.languages.is_empty();
    // Saturating is better than panicking: this counter is only used for a label.
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
mod tests {
    use super::*;
    use crate::notes::fixtures::{NOW, at, note as sample};

    fn request() -> NotesQuery {
        NotesQuery {
            space_id: None,
            search: String::new(),
            filter: NoteFilter::All,
            tags: Vec::new(),
            languages: Vec::new(),
            now: at(NOW),
            tz_offset_minutes: 0,
        }
    }

    fn note(id: &str, title: &str) -> Note {
        Note {
            id: id.to_string(),
            title: title.to_string(),
            created_at: at("2026-07-25T08:00:00.000Z"),
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
                languages: vec![Language::Json, Language::Txt],
            },
            &NotesQuery {
                search: "introuvable".to_string(),
                ..request()
            },
        );

        assert_eq!(view.available_tags, ["api", "auth"]);
        assert_eq!(view.available_languages, [Language::Json, Language::Txt]);
    }

    #[test]
    fn a_selected_language_counts_as_filtering_like_a_selected_tag() {
        // Both rails are facet rails: selecting in either one turns the canvas
        // into a flat result list. Only the quick filters keep the date buckets.
        let view = build(
            vec![note("a", "Un")],
            Facets::default(),
            &NotesQuery {
                languages: vec![Language::Json],
                ..request()
            },
        );

        assert!(view.is_filtering);
        assert_eq!(keys(&view), [NoteSectionKey::Results]);
    }

    mod search {
        use super::*;

        #[test]
        fn the_title_the_tags_and_the_content_are_all_searched() {
            let note = Note {
                title: "Déploiement".to_string(),
                content: "kubectl apply".to_string(),
                tags: vec!["ops".to_string()],
                ..sample()
            };

            assert!(matches_search(&note, "déploi"));
            assert!(matches_search(&note, "kubectl"));
            assert!(matches_search(&note, "ops"));
            assert!(!matches_search(&note, "terraform"));
        }

        #[test]
        fn search_case_folding_reaches_beyond_ascii() {
            let note = Note {
                title: "Étape suivante".to_string(),
                ..sample()
            };

            // SQLite's LOWER() leaves É alone without ICU, so this match is exactly
            // what moving the comparison into Rust buys.
            assert!(matches_search(&note, "étape"));
        }
    }

    mod sections {
        use super::*;
        use crate::notes::model::NoteLifecycle;

        fn utc() -> FixedOffset {
            FixedOffset::east_opt(0).unwrap()
        }

        fn now_at(_offset: FixedOffset) -> DateTime<Utc> {
            at(NOW)
        }

        fn note(id: &str, created_at: &str) -> Note {
            Note {
                id: id.to_string(),
                created_at: at(created_at),
                updated_at: at(created_at),
                ..sample()
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

        #[test]
        fn every_unpinned_note_lands_in_exactly_one_section() {
            let offset = utc();
            let notes = vec![
                note("today", "2026-07-25T08:00:00.000Z"),
                note("week", "2026-07-21T08:00:00.000Z"),
                note("older", "2020-01-01T08:00:00.000Z"),
            ];

            let sections = build_sections(notes, false, now_at(offset), offset);

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

            let sections = build_sections(Vec::new(), false, now_at(offset), offset);

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

            let sections = build_sections(notes, false, now_at(offset), offset);

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

            let sections = build_sections(vec![pinned], false, now_at(offset), offset);

            assert_eq!(ids_in(&sections, NoteSectionKey::Pinned), ["pinned"]);
            assert!(ids_in(&sections, NoteSectionKey::Today).is_empty());
        }

        #[test]
        fn empty_sections_other_than_week_are_omitted() {
            let offset = utc();

            let sections = build_sections(
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

            let sections = build_sections(notes, true, now_at(offset), offset);

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

            let sections = build_sections(
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

            let sections = build_sections(vec![expiring], false, now_at(offset), offset);

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

            let sections = build_sections(
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

            let sections = build_sections(
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

            let sections = build_sections(
                vec![note("future", "2030-01-01T00:00:00.000Z")],
                false,
                now_at(offset),
                offset,
            );

            // is_within rejects negative elapsed time, so it must still surface
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

            let sections = build_sections(notes, false, now_at(offset), offset);

            // The SQL ORDER BY decides; this module must not re-sort.
            assert_eq!(
                ids_in(&sections, NoteSectionKey::Today),
                ["first", "second"]
            );
        }
    }
}
