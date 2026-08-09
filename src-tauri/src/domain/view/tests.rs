use super::*;
use crate::domain::fixtures::{NOW, at, note as sample};

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
