//! Notes lues et écrites contre une vraie base : le chemin complet
//! `storage::notes` puis `domain::view`, tel que `query_notes` l'assemble.
//!
//! Les règles ont leurs tests unitaires dans `domain/` ; ici on vérifie
//! qu'elles s'appliquent à ce que la base a réellement rendu.

use diesel::SqliteConnection;
use diesel::prelude::*;

use chrono::{DateTime, Utc};

use devbox_lib::domain::iso8601;
use devbox_lib::domain::language::Language;
use devbox_lib::domain::note::{Note, NoteDraft, NoteLifecycle, NotePatch};
use devbox_lib::domain::view::{self, NoteFilter, NotesQuery, NotesView};
use devbox_lib::storage::notes::{create, delete, fetch, update};
use devbox_lib::storage::schema::{note_tags, spaces as spaces_table};
use devbox_lib::storage::{StorageError, open_in_memory, spaces};

/// Un tel raccourci n'existe pas dans le code de production : il inviterait à
/// refiltrer côté front.
fn list(connection: &mut SqliteConnection) -> Result<Vec<Note>, StorageError> {
    fetch(
        connection,
        &NotesQuery {
            space_id: None,
            search: String::new(),
            filter: NoteFilter::All,
            tags: Vec::new(),
            languages: Vec::new(),
            now: t0(),
            tz_offset_minutes: 0,
        },
    )
    .map(|(notes, _)| notes)
}

fn at(iso: &str) -> DateTime<Utc> {
    iso8601::parse(iso).expect("les tests écrivent des instants valides")
}

fn t0() -> DateTime<Utc> {
    at("2026-07-25T09:00:00.000Z")
}

fn t1() -> DateTime<Utc> {
    at("2026-07-25T10:00:00.000Z")
}

fn query(
    connection: &mut SqliteConnection,
    request: &NotesQuery,
) -> Result<NotesView, StorageError> {
    let (notes, facets) = fetch(connection, request)?;
    Ok(view::build(notes, facets, request))
}

fn space(connection: &mut SqliteConnection, name: &str) -> String {
    spaces::create(connection, name).unwrap().id
}

fn draft(space_id: &str) -> NoteDraft {
    NoteDraft {
        space_id: space_id.to_string(),
        title: "Titre".to_string(),
        language: Language::Txt,
        content: "Contenu".to_string(),
        source: "API Gateway / Auth".to_string(),
        tags: vec!["auth".to_string(), "api".to_string()],
        pinned: false,
        lifecycle: NoteLifecycle::Permanent,
    }
}

#[test]
fn a_created_note_is_read_back_whole() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");

    let created = create(&mut connection, draft(&space_id), t0()).unwrap();
    let listed = list(&mut connection).unwrap();

    assert_eq!(listed.len(), 1);
    let note = &listed[0];
    assert_eq!(note.id, created.id);
    assert_eq!(note.space_id, space_id);
    assert_eq!(note.title, "Titre");
    assert_eq!(note.content, "Contenu");
    assert_eq!(note.source, "API Gateway / Auth");
    assert!(!note.pinned);
    assert_eq!(note.tags, ["api", "auth"]);
}

#[test]
fn creation_stamps_both_dates_identically() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");

    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    assert_eq!(created.created_at, t0());
    assert_eq!(created.updated_at, t0());
}

#[test]
fn an_expiring_lifecycle_survives_a_round_trip() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let expiring = NoteDraft {
        lifecycle: NoteLifecycle::Expires {
            at: at("2026-08-01T00:00:00.000Z"),
        },
        ..draft(&space_id)
    };

    create(&mut connection, expiring, t0()).unwrap();

    let deadline = at("2026-08-01T00:00:00.000Z");
    let listed = list(&mut connection).unwrap();
    assert!(matches!(
        &listed[0].lifecycle,
        NoteLifecycle::Expires { at } if *at == deadline
    ));
}

#[test]
fn dropping_an_expiry_clears_the_stored_date() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let expiring = NoteDraft {
        lifecycle: NoteLifecycle::Expires {
            at: at("2026-08-01T00:00:00.000Z"),
        },
        ..draft(&space_id)
    };
    let created = create(&mut connection, expiring, t0()).unwrap();

    let patch = NotePatch {
        lifecycle: Some(NoteLifecycle::Permanent),
        ..NotePatch::default()
    };
    update(&mut connection, &created.id, &patch, t1()).unwrap();

    // The schema's CHECK ties the two columns together: leaving the date
    // behind would make the write fail outright.
    assert!(matches!(
        list(&mut connection).unwrap()[0].lifecycle,
        NoteLifecycle::Permanent
    ));
}

#[test]
fn creating_in_an_unknown_space_is_refused() {
    let mut connection = open_in_memory().unwrap();

    let error = create(&mut connection, draft("inconnu"), t0()).unwrap_err();

    assert!(matches!(error, StorageError::SpaceNotFound(_)));
    assert!(list(&mut connection).unwrap().is_empty());
}

#[test]
fn notes_are_listed_most_recently_updated_first() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");

    let older = create(&mut connection, draft(&space_id), t0()).unwrap();
    let newer = create(&mut connection, draft(&space_id), t1()).unwrap();

    let ids: Vec<String> = list(&mut connection)
        .unwrap()
        .into_iter()
        .map(|n| n.id)
        .collect();

    assert_eq!(ids, [newer.id, older.id]);
}

#[test]
fn an_absent_patch_field_leaves_the_stored_value_untouched() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    let patch = NotePatch {
        title: Some("Nouveau titre".to_string()),
        ..NotePatch::default()
    };
    let updated = update(&mut connection, &created.id, &patch, t1()).unwrap();

    assert_eq!(updated.title, "Nouveau titre");
    assert_eq!(updated.content, "Contenu");
    assert_eq!(updated.source, "API Gateway / Auth");
    assert_eq!(updated.tags, ["api", "auth"]);
    assert!(matches!(updated.lifecycle, NoteLifecycle::Permanent));
}

#[test]
fn updating_refreshes_updated_at_but_not_created_at() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    let updated = update(&mut connection, &created.id, &NotePatch::default(), t1()).unwrap();

    assert_eq!(updated.created_at, t0());
    assert_eq!(updated.updated_at, t1());
}

#[test]
fn pasting_into_a_freshly_created_note_settles_its_language() {
    // End to end for the ordinary gesture: create empty, then paste. The
    // rule is tested in `domain::detect`; here we check it actually reaches
    // the stored row.
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let empty = NoteDraft {
        language: Language::Txt,
        content: String::new(),
        ..draft(&space_id)
    };
    let created = create(&mut connection, empty, t0()).unwrap();

    let patch = NotePatch {
        content: Some("interface Note { id: string }".to_string()),
        ..NotePatch::default()
    };
    let updated = update(&mut connection, &created.id, &patch, t1()).unwrap();

    assert_eq!(updated.language, Language::Ts);
    assert_eq!(list(&mut connection).unwrap()[0].language, Language::Ts);
}

#[test]
fn a_later_edit_does_not_move_the_language_again() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let empty = NoteDraft {
        language: Language::Txt,
        content: String::new(),
        ..draft(&space_id)
    };
    let created = create(&mut connection, empty, t0()).unwrap();

    let first = NotePatch {
        content: Some("SELECT 1".to_string()),
        ..NotePatch::default()
    };
    update(&mut connection, &created.id, &first, t1()).unwrap();

    let second = NotePatch {
        content: Some("interface Note { id: string }".to_string()),
        ..NotePatch::default()
    };
    let updated = update(&mut connection, &created.id, &second, t1()).unwrap();

    // The note had an identity by then; only the first content decides.
    assert_eq!(updated.language, Language::Sql);
}

#[test]
fn patching_tags_replaces_the_whole_set() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    let patch = NotePatch {
        tags: Some(vec!["sql".to_string()]),
        ..NotePatch::default()
    };
    update(&mut connection, &created.id, &patch, t1()).unwrap();

    assert_eq!(list(&mut connection).unwrap()[0].tags, ["sql"]);
}

#[test]
fn mixed_case_tags_come_back_in_the_same_order_a_reload_gives() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    let patch = NotePatch {
        tags: Some(vec!["Urgent".to_string(), "auth".to_string()]),
        ..NotePatch::default()
    };
    let updated = update(&mut connection, &created.id, &patch, t1()).unwrap();

    // The column is COLLATE NOCASE, so a read orders "auth" before "Urgent";
    // a byte-wise sort on the write path would answer the other way round and
    // the editor's tags would shuffle on the next reload.
    assert_eq!(updated.tags, ["auth", "Urgent"]);
    assert_eq!(list(&mut connection).unwrap()[0].tags, updated.tags);
}

#[test]
fn patching_tags_to_an_empty_list_clears_them() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    let patch = NotePatch {
        tags: Some(Vec::new()),
        ..NotePatch::default()
    };
    let updated = update(&mut connection, &created.id, &patch, t1()).unwrap();

    assert!(updated.tags.is_empty());
    assert!(list(&mut connection).unwrap()[0].tags.is_empty());
}

#[test]
fn a_note_can_be_moved_to_another_space() {
    let mut connection = open_in_memory().unwrap();
    let origin = space(&mut connection, "Perso");
    let destination = space(&mut connection, "Boulot");
    let created = create(&mut connection, draft(&origin), t0()).unwrap();

    let patch = NotePatch {
        space_id: Some(destination.clone()),
        ..NotePatch::default()
    };
    let updated = update(&mut connection, &created.id, &patch, t1()).unwrap();

    assert_eq!(updated.space_id, destination);
}

#[test]
fn moving_a_note_to_an_unknown_space_is_refused_and_changes_nothing() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    let patch = NotePatch {
        space_id: Some("inconnu".to_string()),
        title: Some("Ne doit pas passer".to_string()),
        ..NotePatch::default()
    };
    let error = update(&mut connection, &created.id, &patch, t1()).unwrap_err();

    assert!(matches!(error, StorageError::SpaceNotFound(_)));
    let note = &list(&mut connection).unwrap()[0];
    assert_eq!(note.space_id, space_id);
    assert_eq!(note.title, "Titre");
}

#[test]
fn updating_an_unknown_note_reports_an_error() {
    let mut connection = open_in_memory().unwrap();

    let error = update(&mut connection, "inconnu", &NotePatch::default(), t1()).unwrap_err();

    assert!(matches!(error, StorageError::NoteNotFound(_)));
}

#[test]
fn deleting_removes_the_note_and_its_tags() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    delete(&mut connection, &created.id).unwrap();

    assert!(list(&mut connection).unwrap().is_empty());
    let orphan_tags = note_tags::table
        .count()
        .get_result::<i64>(&mut connection)
        .unwrap();
    assert_eq!(orphan_tags, 0);
}

#[test]
fn deleting_an_unknown_note_reports_an_error() {
    let mut connection = open_in_memory().unwrap();

    let error = delete(&mut connection, "inconnu").unwrap_err();

    assert!(matches!(error, StorageError::NoteNotFound(_)));
}

/// Neutral query: everything, no search, no tags. Tests override one field
/// at a time so each one states exactly what it exercises.
fn all_notes() -> NotesQuery {
    NotesQuery {
        space_id: None,
        search: String::new(),
        filter: NoteFilter::All,
        tags: Vec::new(),
        languages: Vec::new(),
        now: t1(),
        tz_offset_minutes: 0,
    }
}

fn matched_ids(view: &NotesView) -> Vec<String> {
    view.sections
        .iter()
        .flat_map(|section| section.notes.iter().map(|note| note.id.clone()))
        .collect()
}

fn tagged(space_id: &str, tags: &[&str]) -> NoteDraft {
    NoteDraft {
        tags: tags.iter().copied().map(String::from).collect(),
        ..draft(space_id)
    }
}

fn written_in(space_id: &str, language: Language) -> NoteDraft {
    NoteDraft {
        language,
        ..draft(space_id)
    }
}

#[test]
fn a_query_without_criteria_returns_every_note() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    let view = query(&mut connection, &all_notes()).unwrap();

    assert_eq!(view.matched, 1);
    assert!(!view.is_filtering);
}

#[test]
fn the_space_filter_excludes_the_other_spaces() {
    let mut connection = open_in_memory().unwrap();
    let here = space(&mut connection, "Perso");
    let elsewhere = space(&mut connection, "Boulot");
    let kept = create(&mut connection, draft(&here), t0()).unwrap();
    create(&mut connection, draft(&elsewhere), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            space_id: Some(here),
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(matched_ids(&view), [kept.id]);
}

#[test]
fn no_space_means_every_space_rather_than_none() {
    let mut connection = open_in_memory().unwrap();
    let here = space(&mut connection, "Perso");
    let elsewhere = space(&mut connection, "Boulot");
    create(&mut connection, draft(&here), t0()).unwrap();
    create(&mut connection, draft(&elsewhere), t0()).unwrap();

    let view = query(&mut connection, &all_notes()).unwrap();

    assert_eq!(view.matched, 2);
}

#[test]
fn the_pinned_filter_keeps_only_pinned_notes() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let pinned = create(
        &mut connection,
        NoteDraft {
            pinned: true,
            ..draft(&space_id)
        },
        t0(),
    )
    .unwrap();
    create(&mut connection, draft(&space_id), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            filter: NoteFilter::Pinned,
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(matched_ids(&view), [pinned.id]);
}

#[test]
fn the_untriaged_filter_keeps_only_expiring_notes() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let expiring = create(
        &mut connection,
        NoteDraft {
            lifecycle: NoteLifecycle::Expires {
                at: at("2026-08-01T00:00:00.000Z"),
            },
            ..draft(&space_id)
        },
        t0(),
    )
    .unwrap();
    create(&mut connection, draft(&space_id), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            filter: NoteFilter::Untriaged,
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(matched_ids(&view), [expiring.id]);
}

#[test]
fn a_quick_filter_alone_does_not_switch_to_results_mode() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            filter: NoteFilter::Pinned,
            ..all_notes()
        },
    )
    .unwrap();

    // Pinned/untriaged narrow a view that stays chronological; only a search
    // or a tag selection collapses it into a flat result list.
    assert!(!view.is_filtering);
}

#[test]
fn the_search_matches_the_title_the_content_and_the_tags() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let by_title = create(
        &mut connection,
        NoteDraft {
            title: "Script de deploiement".to_string(),
            content: String::new(),
            tags: Vec::new(),
            ..draft(&space_id)
        },
        t0(),
    )
    .unwrap();
    let by_content = create(
        &mut connection,
        NoteDraft {
            title: String::new(),
            content: "kubectl rollout".to_string(),
            tags: Vec::new(),
            ..draft(&space_id)
        },
        t0(),
    )
    .unwrap();
    let by_tag = create(&mut connection, tagged(&space_id, &["urgent"]), t0()).unwrap();

    for (needle, expected) in [
        ("deploiement", &by_title),
        ("rollout", &by_content),
        ("urgent", &by_tag),
    ] {
        let view = query(
            &mut connection,
            &NotesQuery {
                search: needle.to_string(),
                ..all_notes()
            },
        )
        .unwrap();
        assert_eq!(
            matched_ids(&view),
            [expected.id.as_str()],
            "needle: {needle}"
        );
    }
}

#[test]
fn the_search_ignores_case_beyond_ascii() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(
        &mut connection,
        NoteDraft {
            title: "Étape de migration".to_string(),
            ..draft(&space_id)
        },
        t0(),
    )
    .unwrap();

    // SQLite's LOWER() only folds ASCII, so "É" would never match "é" if the
    // search were pushed into SQL. This is why it is done in Rust.
    let view = query(
        &mut connection,
        &NotesQuery {
            search: "étape".to_string(),
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(view.matched, 1);
}

#[test]
fn a_blank_search_is_not_a_search() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            search: "   ".to_string(),
            ..all_notes()
        },
    )
    .unwrap();

    assert!(!view.is_filtering);
    assert_eq!(view.matched, 1);
}

#[test]
fn a_note_matches_when_it_carries_at_least_one_selected_tag() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let one = create(&mut connection, tagged(&space_id, &["urgent"]), t0()).unwrap();
    let two = create(&mut connection, tagged(&space_id, &["later"]), t0()).unwrap();
    create(&mut connection, tagged(&space_id, &["neither"]), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            tags: vec!["urgent".to_string(), "later".to_string()],
            ..all_notes()
        },
    )
    .unwrap();

    // A facet rail is a union, not an intersection: requiring every tag
    // would make a second selection almost always empty.
    let ids = matched_ids(&view);
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&one.id) && ids.contains(&two.id));
    assert!(view.is_filtering);
}

#[test]
fn a_selected_tag_is_normalised_like_a_stored_one() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, tagged(&space_id, &["urgent"]), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            tags: vec![" #urgent ".to_string()],
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(view.matched, 1);
}

#[test]
fn a_selected_tag_matches_a_stored_one_of_a_different_case() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, tagged(&space_id, &["Urgent"]), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            tags: vec!["urgent".to_string()],
            ..all_notes()
        },
    )
    .unwrap();

    // Without COLLATE NOCASE on note_tags.tag the IN (…) comparison runs in
    // BINARY and misses: the rail would offer a facet selecting nothing.
    assert_eq!(view.matched, 1);
}

#[test]
fn the_rail_offers_one_facet_for_tags_differing_only_in_case() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, tagged(&space_id, &["Urgent"]), t0()).unwrap();
    create(&mut connection, tagged(&space_id, &["urgent"]), t1()).unwrap();

    let view = query(&mut connection, &all_notes()).unwrap();

    // normalize_tags folds case within one note; the collation extends that
    // to the whole corpus, which is what the rail reads.
    assert_eq!(view.available_tags.len(), 1);
}

#[test]
fn criteria_combine_rather_than_replace_each_other() {
    let mut connection = open_in_memory().unwrap();
    let here = space(&mut connection, "Perso");
    let elsewhere = space(&mut connection, "Boulot");

    let target = create(
        &mut connection,
        NoteDraft {
            title: "deploy".to_string(),
            pinned: true,
            tags: vec!["urgent".to_string()],
            ..draft(&here)
        },
        t0(),
    )
    .unwrap();
    // Each of these fails exactly one criterion.
    create(
        &mut connection,
        NoteDraft {
            title: "deploy".to_string(),
            pinned: true,
            tags: vec!["later".to_string()],
            ..draft(&here)
        },
        t0(),
    )
    .unwrap();
    create(
        &mut connection,
        NoteDraft {
            title: "deploy".to_string(),
            pinned: false,
            tags: vec!["urgent".to_string()],
            ..draft(&here)
        },
        t0(),
    )
    .unwrap();
    create(
        &mut connection,
        NoteDraft {
            title: "autre".to_string(),
            pinned: true,
            tags: vec!["urgent".to_string()],
            ..draft(&here)
        },
        t0(),
    )
    .unwrap();
    create(
        &mut connection,
        NoteDraft {
            title: "deploy".to_string(),
            pinned: true,
            tags: vec!["urgent".to_string()],
            ..draft(&elsewhere)
        },
        t0(),
    )
    .unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            space_id: Some(here),
            search: "deploy".to_string(),
            filter: NoteFilter::Pinned,
            tags: vec!["urgent".to_string()],
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(matched_ids(&view), [target.id]);
}

#[test]
fn a_note_matches_when_it_is_written_in_one_of_the_selected_languages() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let json = create(&mut connection, written_in(&space_id, Language::Json), t0()).unwrap();
    let yml = create(&mut connection, written_in(&space_id, Language::Yml), t0()).unwrap();
    create(&mut connection, written_in(&space_id, Language::Py), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            languages: vec![Language::Json, Language::Yml],
            ..all_notes()
        },
    )
    .unwrap();

    // A union like the tag rail, not an intersection: a note has exactly one
    // language, so requiring all of them would always match nothing.
    let ids = matched_ids(&view);
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&json.id) && ids.contains(&yml.id));
    assert!(view.is_filtering);
}

#[test]
fn the_language_filter_combines_with_the_other_criteria() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let target = create(
        &mut connection,
        NoteDraft {
            title: "deploy".to_string(),
            ..written_in(&space_id, Language::Yml)
        },
        t0(),
    )
    .unwrap();
    create(&mut connection, written_in(&space_id, Language::Yml), t0()).unwrap();
    create(
        &mut connection,
        NoteDraft {
            title: "deploy".to_string(),
            ..written_in(&space_id, Language::Json)
        },
        t0(),
    )
    .unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            search: "deploy".to_string(),
            languages: vec![Language::Yml],
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(matched_ids(&view), [target.id]);
}

#[test]
fn available_languages_are_sorted_and_de_duplicated() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, written_in(&space_id, Language::Yml), t0()).unwrap();
    create(&mut connection, written_in(&space_id, Language::Json), t0()).unwrap();
    create(&mut connection, written_in(&space_id, Language::Json), t1()).unwrap();

    let view = query(&mut connection, &all_notes()).unwrap();

    assert_eq!(view.available_languages, [Language::Json, Language::Yml]);
}

#[test]
fn available_languages_are_scoped_to_the_active_space() {
    let mut connection = open_in_memory().unwrap();
    let here = space(&mut connection, "Perso");
    let elsewhere = space(&mut connection, "Boulot");
    create(&mut connection, written_in(&here, Language::Json), t0()).unwrap();
    create(&mut connection, written_in(&elsewhere, Language::Sql), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            space_id: Some(here),
            ..all_notes()
        },
    )
    .unwrap();

    // Offering a language that filters nothing in the current space is noise.
    assert_eq!(view.available_languages, [Language::Json]);
}

#[test]
fn available_languages_ignore_the_current_selection() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, written_in(&space_id, Language::Json), t0()).unwrap();
    create(&mut connection, written_in(&space_id, Language::Yml), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            languages: vec![Language::Json],
            ..all_notes()
        },
    )
    .unwrap();

    // Narrowing the rail to the current results would make a second selection
    // impossible.
    assert_eq!(view.available_languages, [Language::Json, Language::Yml]);
    assert_eq!(view.matched, 1);
}

#[test]
fn available_tags_are_sorted_and_de_duplicated() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, tagged(&space_id, &["zeta", "alpha"]), t0()).unwrap();
    create(&mut connection, tagged(&space_id, &["alpha", "beta"]), t0()).unwrap();

    let view = query(&mut connection, &all_notes()).unwrap();

    assert_eq!(view.available_tags, ["alpha", "beta", "zeta"]);
}

#[test]
fn available_tags_are_scoped_to_the_active_space() {
    let mut connection = open_in_memory().unwrap();
    let here = space(&mut connection, "Perso");
    let elsewhere = space(&mut connection, "Boulot");
    create(&mut connection, tagged(&here, &["here-tag"]), t0()).unwrap();
    create(
        &mut connection,
        tagged(&elsewhere, &["elsewhere-tag"]),
        t0(),
    )
    .unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            space_id: Some(here),
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(view.available_tags, ["here-tag"]);
}

#[test]
fn available_tags_ignore_the_current_search_and_selection() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, tagged(&space_id, &["urgent"]), t0()).unwrap();
    create(&mut connection, tagged(&space_id, &["later"]), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            tags: vec!["urgent".to_string()],
            ..all_notes()
        },
    )
    .unwrap();

    assert_eq!(view.available_tags, ["later", "urgent"]);
    assert_eq!(view.matched, 1);
}

#[test]
fn a_search_matching_nothing_reports_filtering_with_zero_matches() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    let view = query(
        &mut connection,
        &NotesQuery {
            search: "introuvable".to_string(),
            ..all_notes()
        },
    )
    .unwrap();

    // The pair (is_filtering, matched) is what lets the UI say "no results"
    // rather than "this space is empty".
    assert!(view.is_filtering);
    assert_eq!(view.matched, 0);
}

#[test]
fn the_view_orders_notes_most_recently_updated_first() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let older = create(&mut connection, draft(&space_id), t0()).unwrap();
    let newer = create(&mut connection, draft(&space_id), t1()).unwrap();

    let view = query(&mut connection, &all_notes()).unwrap();

    assert_eq!(matched_ids(&view), [newer.id, older.id]);
}

#[test]
fn tags_are_normalised_on_write() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");

    let created = create(
        &mut connection,
        tagged(&space_id, &["  #urgent ", "URGENT", "", " # ", "later"]),
        t0(),
    )
    .unwrap();

    assert_eq!(created.tags, ["later", "urgent"]);
    assert_eq!(list(&mut connection).unwrap()[0].tags, ["later", "urgent"]);
}

#[test]
fn a_normalised_write_returns_what_a_read_would_return() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");

    let created = create(&mut connection, tagged(&space_id, &["zeta", "alpha"]), t0()).unwrap();

    // The front adopts the returned note; a different order here would make
    // the tags jump around on the next reload.
    assert_eq!(created.tags, list(&mut connection).unwrap()[0].tags);
}

#[test]
fn deleting_a_space_takes_its_notes_with_it() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    diesel::delete(spaces_table::table.find(&space_id))
        .execute(&mut connection)
        .unwrap();

    // No command exposes this yet, but the cascade must already hold:
    // a note whose space is gone would be invisible and unreachable.
    assert!(list(&mut connection).unwrap().is_empty());
}

#[test]
fn a_stored_date_that_is_out_of_format_is_reported_rather_than_guessed() {
    // Les branches « date illisible » du domaine ont disparu avec le typage :
    // la faillibilité a migré ici, où elle est signalée au lieu d'être devinée.
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    diesel::update(devbox_lib::storage::schema::notes::table.find(&created.id))
        .set(devbox_lib::storage::schema::notes::created_at.eq("pas une date"))
        .execute(&mut connection)
        .unwrap();

    let error = list(&mut connection).unwrap_err();

    assert!(matches!(
        error,
        StorageError::CorruptRow {
            field: "createdAt",
            ..
        }
    ));
}

#[test]
fn a_stored_date_always_carries_its_milliseconds() {
    // Le canevas trie sur cette colonne TEXT : sans millisecondes, deux notes de
    // la même seconde s'ordonnent à l'envers (voir `domain::iso8601`).
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let round_second = at("2026-07-25T09:00:00Z");

    let created = create(&mut connection, draft(&space_id), round_second).unwrap();

    let stored: String = devbox_lib::storage::schema::notes::table
        .find(&created.id)
        .select(devbox_lib::storage::schema::notes::updated_at)
        .first(&mut connection)
        .unwrap();

    assert_eq!(stored, "2026-07-25T09:00:00.000Z");
}
