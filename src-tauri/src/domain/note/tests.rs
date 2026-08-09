use super::*;
use crate::domain::fixtures::note as sample;
use crate::domain::language::Language;

const NOW: &str = "2026-07-25T09:00:00.000Z";

fn at(iso: &str) -> DateTime<Utc> {
    crate::domain::iso8601::parse(iso).unwrap()
}

fn now() -> DateTime<Utc> {
    at(NOW)
}

fn expiring(at_iso: &str) -> Note {
    Note {
        lifecycle: NoteLifecycle::Expires { at: at(at_iso) },
        ..sample()
    }
}

fn draft(language: Language, content: &str) -> NoteDraft {
    NoteDraft {
        space_id: "s-1".to_string(),
        title: "Titre".to_string(),
        language,
        content: content.to_string(),
        source: "API Gateway".to_string(),
        tags: vec!["  #Urgent ".to_string(), "urgent".to_string()],
        pinned: true,
        lifecycle: NoteLifecycle::Permanent,
    }
}

#[test]
fn a_draft_becomes_a_note_carrying_the_id_and_the_instant_it_was_given() {
    let note = draft(Language::Md, "du texte").into_note("n-7".to_string(), now());

    assert_eq!(note.id, "n-7");
    assert_eq!(note.created_at, now());
    assert_eq!(note.updated_at, now());
}

#[test]
fn turning_a_draft_into_a_note_detects_the_language_and_normalises_the_tags() {
    // Both rules used to run in `storage`, where they needed an open database
    // to be exercised at all.
    let note = draft(Language::Txt, "{\"a\": 1}").into_note("n-7".to_string(), now());

    assert_eq!(note.language, Language::Json);
    assert_eq!(note.tags, ["Urgent"]);
}

#[test]
fn turning_a_draft_into_a_note_leaves_everything_else_alone() {
    let note = draft(Language::Md, "SELECT 1").into_note("n-7".to_string(), now());

    // A chosen language is a decision; only the rest travels verbatim.
    assert_eq!(note.language, Language::Md);
    assert_eq!(note.content, "SELECT 1");
    assert_eq!(note.space_id, "s-1");
    assert_eq!(note.source, "API Gateway");
    assert!(note.pinned);
}

#[test]
fn a_patch_only_touches_the_fields_it_carries() {
    let mut note = sample();
    let patch = NotePatch {
        title: Some("Nouveau".to_string()),
        ..NotePatch::default()
    };

    patch.apply(&mut note, at("2026-07-25T10:00:00.000Z"));

    assert_eq!(note.title, "Nouveau");
    assert_eq!(note.content, "Contenu");
    assert_eq!(note.tags, ["auth"]);
    assert_eq!(note.updated_at, at("2026-07-25T10:00:00.000Z"));
    // `created_at` is the one stamp nothing may move.
    assert_eq!(note.created_at, now());
}

#[test]
fn a_patch_normalises_the_tags_it_replaces() {
    let mut note = sample();
    let patch = NotePatch {
        tags: Some(vec![
            "  #Ops ".to_string(),
            "OPS".to_string(),
            " ".to_string(),
        ]),
        ..NotePatch::default()
    };

    patch.apply(&mut note, now());

    assert_eq!(note.tags, ["Ops"]);
}

#[test]
fn a_patch_filling_an_empty_note_detects_its_language() {
    // Decided on the state *before* the patch: that is what says whether the
    // note is receiving its first content.
    let mut note = Note {
        language: Language::Txt,
        content: String::new(),
        ..sample()
    };
    let patch = NotePatch {
        content: Some("SELECT 1".to_string()),
        ..NotePatch::default()
    };

    patch.apply(&mut note, now());

    assert_eq!(note.language, Language::Sql);
}

#[test]
fn an_ordinary_note_shows_the_age_of_its_last_change() {
    let footer = footer_of(&sample());

    assert_eq!(footer, NoteFooter::Age { at: at(NOW) });
}

#[test]
fn a_pinned_note_shows_the_first_segment_of_its_context() {
    let note = Note {
        pinned: true,
        source: "API Gateway / Auth / Tokens".to_string(),
        ..sample()
    };

    assert_eq!(
        footer_of(&note),
        NoteFooter::Source {
            value: "API Gateway".to_string()
        }
    );
}

#[test]
fn a_pinned_note_without_context_falls_back_to_its_age() {
    let note = Note {
        pinned: true,
        source: String::new(),
        ..sample()
    };

    assert!(matches!(footer_of(&note), NoteFooter::Age { .. }));
}

#[test]
fn an_expiring_note_shows_its_deadline_even_when_pinned() {
    let note = Note {
        pinned: true,
        source: "API Gateway".to_string(),
        ..expiring("2026-08-01T00:00:00.000Z")
    };

    // The deadline is the more urgent thing to know; the context can wait.
    assert!(matches!(footer_of(&note), NoteFooter::Expiry { .. }));
}

#[test]
fn a_permanent_note_never_counts_as_expiring_soon() {
    assert!(!expires_soon(&sample(), now()));
}

#[test]
fn the_threshold_is_measured_in_fractions_of_a_day() {
    // Three days and one hour is not "soon"; rounding to whole days would
    // raise the alert a day early.
    assert!(!expires_soon(&expiring("2026-07-28T10:00:00.000Z"), now()));
    assert!(expires_soon(&expiring("2026-07-28T08:00:00.000Z"), now()));
}

#[test]
fn an_already_expired_note_counts_as_expiring_soon() {
    assert!(expires_soon(&expiring("2026-07-01T00:00:00.000Z"), now()));
}
