//! Notes lues et écrites contre une vraie base : le chemin complet
//! `storage::notes` puis `domain::view`, tel que `query_notes` l'assemble.
//!
//! Les règles ont leurs tests unitaires dans `domain/` ; ici on vérifie
//! qu'elles s'appliquent à ce que la base a réellement rendu.

use std::collections::BTreeMap;

use diesel::SqliteConnection;
use diesel::prelude::*;

use chrono::{DateTime, Utc};

use devbox_lib::db::iso8601;
use devbox_lib::db::open_in_memory;
use devbox_lib::db::schema::{note_items, note_placeholders, note_tags, spaces as spaces_table};
use devbox_lib::error::StorageError;
use devbox_lib::notes::checklist::{ChecklistItem, NoteKind};
use devbox_lib::notes::language::Language;
use devbox_lib::notes::model::{Note, NoteDraft, NoteLifecycle, NotePatch, decorate};
use devbox_lib::notes::store::{
    all, by_ids, create, delete, drop_tag, expired_ids, fetch, insert_imported, list_trashed,
    move_many, purge, restore_many, retag, set_placeholder_values, tag_many, tag_usage, update,
};
use devbox_lib::notes::view::{self, NoteFilter, NotesQuery, NotesView};
use devbox_lib::spaces::store as spaces;

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
        kind: NoteKind::Snippet,
        items: Vec::new(),
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

fn item(text: &str, done: bool) -> ChecklistItem {
    ChecklistItem {
        text: text.to_string(),
        done,
    }
}

fn checklist(space_id: &str, items: Vec<ChecklistItem>) -> NoteDraft {
    NoteDraft {
        kind: NoteKind::Checklist,
        content: String::new(),
        items,
        ..draft(space_id)
    }
}

#[test]
fn a_checklist_is_read_back_in_the_order_it_was_written() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");

    let created = create(
        &mut connection,
        checklist(
            &space_id,
            vec![item("Relire", true), item("Déployer", false)],
        ),
        t0(),
    )
    .unwrap();

    assert_eq!(created.kind, NoteKind::Checklist);
    assert_eq!(
        created.items,
        [item("Relire", true), item("Déployer", false)]
    );
    // La position porte l'ordre : une relecture ne doit pas le retrier.
    assert_eq!(list(&mut connection).unwrap()[0].items, created.items);
}

#[test]
fn patching_the_items_replaces_the_whole_list() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(
        &mut connection,
        checklist(
            &space_id,
            vec![item("a", false), item("b", false), item("c", false)],
        ),
        t0(),
    )
    .unwrap();

    let updated = update(
        &mut connection,
        &created.id,
        &NotePatch {
            items: Some(vec![item("c", true), item("a", false)]),
            ..NotePatch::default()
        },
        t1(),
    )
    .unwrap();

    assert_eq!(updated.items, [item("c", true), item("a", false)]);
    assert_eq!(list(&mut connection).unwrap()[0].items, updated.items);
}

#[test]
fn emptying_the_list_leaves_no_row_behind() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(
        &mut connection,
        checklist(&space_id, vec![item("a", false)]),
        t0(),
    )
    .unwrap();

    update(
        &mut connection,
        &created.id,
        &NotePatch {
            items: Some(Vec::new()),
            ..NotePatch::default()
        },
        t1(),
    )
    .unwrap();

    assert!(list(&mut connection).unwrap()[0].items.is_empty());
    assert_eq!(
        note_items::table
            .count()
            .get_result::<i64>(&mut connection)
            .unwrap(),
        0
    );
}

#[test]
fn a_patch_that_says_nothing_about_the_items_leaves_them_stored() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(
        &mut connection,
        checklist(&space_id, vec![item("a", true)]),
        t0(),
    )
    .unwrap();

    let updated = update(
        &mut connection,
        &created.id,
        &NotePatch {
            title: Some("Sprint".to_string()),
            ..NotePatch::default()
        },
        t1(),
    )
    .unwrap();

    assert_eq!(updated.items, [item("a", true)]);
}

#[test]
fn purging_removes_the_note_and_its_items_for_good() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(
        &mut connection,
        checklist(&space_id, vec![item("a", false)]),
        t0(),
    )
    .unwrap();
    delete(&mut connection, &created.id, t1()).unwrap();

    purge(&mut connection, std::slice::from_ref(&created.id)).unwrap();

    // Le `ON DELETE CASCADE` ne s'applique que si `PRAGMA foreign_keys` est posé
    // sur la connexion — c'est ce que ce compte vérifie réellement.
    assert_eq!(
        note_items::table
            .count()
            .get_result::<i64>(&mut connection)
            .unwrap(),
        0
    );
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
fn deleting_takes_the_note_off_the_canvas_without_destroying_it() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    delete(&mut connection, &created.id, t1()).unwrap();

    assert!(list(&mut connection).unwrap().is_empty());
    // Les tags survivent : ils reviendront avec la note si elle est restaurée.
    let kept_tags = note_tags::table
        .count()
        .get_result::<i64>(&mut connection)
        .unwrap();
    assert_eq!(kept_tags, 2);

    let trashed = list_trashed(&mut connection).unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].0.id, created.id);
    assert_eq!(trashed[0].1, t1());
}

#[test]
fn a_restored_note_comes_back_whole() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();
    delete(&mut connection, &created.id, t1()).unwrap();

    assert_eq!(
        restore_many(&mut connection, std::slice::from_ref(&created.id)).unwrap(),
        1
    );

    let listed = list(&mut connection).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].tags, ["api", "auth"]);
    // `updated_at` intact : restaurer ne fait pas remonter la note en tête.
    assert_eq!(listed[0].updated_at, t0());
}

#[test]
fn a_trashed_note_is_no_longer_editable() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();
    delete(&mut connection, &created.id, t1()).unwrap();

    let error = update(&mut connection, &created.id, &NotePatch::default(), t1()).unwrap_err();

    assert!(matches!(error, StorageError::NoteNotFound(_)));
}

#[test]
fn purging_removes_the_note_and_its_tags_for_good() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();
    delete(&mut connection, &created.id, t1()).unwrap();

    assert_eq!(
        purge(&mut connection, std::slice::from_ref(&created.id)).unwrap(),
        1
    );

    assert!(list_trashed(&mut connection).unwrap().is_empty());
    let orphan_tags = note_tags::table
        .count()
        .get_result::<i64>(&mut connection)
        .unwrap();
    assert_eq!(orphan_tags, 0);
}

#[test]
fn a_note_still_on_the_canvas_cannot_be_purged() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();

    // Le sursis de 30 jours ne doit pas pouvoir être court-circuité.
    assert_eq!(
        purge(&mut connection, std::slice::from_ref(&created.id)).unwrap(),
        0
    );
    assert_eq!(list(&mut connection).unwrap().len(), 1);
}

#[test]
fn only_notes_past_the_retention_are_reported_as_expired() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let old = create(&mut connection, draft(&space_id), t0()).unwrap();
    let recent = create(&mut connection, draft(&space_id), t0()).unwrap();
    delete(&mut connection, &old.id, t0()).unwrap();
    delete(&mut connection, &recent.id, at("2026-08-20T09:00:00.000Z")).unwrap();

    let expired = expired_ids(&mut connection, at("2026-08-25T09:00:00.000Z")).unwrap();

    assert_eq!(expired, [old.id]);
}

#[test]
fn deleting_an_unknown_note_reports_an_error() {
    let mut connection = open_in_memory().unwrap();

    let error = delete(&mut connection, "inconnu", t1()).unwrap_err();

    assert!(matches!(error, StorageError::NoteNotFound(_)));
}

#[test]
fn deleting_the_same_note_twice_reports_an_error_rather_than_a_silent_ok() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, draft(&space_id), t0()).unwrap();
    delete(&mut connection, &created.id, t1()).unwrap();

    let error = delete(&mut connection, &created.id, t1()).unwrap_err();

    assert!(matches!(error, StorageError::NoteNotFound(_)));
}

// --- Valeurs des champs `{{…}}` ---------------------------------------------

/// Le snippet de référence de cette section : deux champs, dont un à valeur
/// par défaut.
fn templated(space_id: &str) -> NoteDraft {
    NoteDraft {
        content: "psql -h {{host}} -p {{port=5432}}".to_string(),
        ..draft(space_id)
    }
}

fn values(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
        .collect()
}

#[test]
fn a_filled_field_is_read_back_on_the_next_opening() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, templated(&space_id), t0()).unwrap();

    set_placeholder_values(&mut connection, &created.id, &values(&[("host", "db")])).unwrap();

    let listed = list(&mut connection).unwrap();
    assert_eq!(listed[0].placeholder_values, values(&[("host", "db")]));
}

#[test]
fn filling_a_field_does_not_touch_updated_at() {
    // Le canevas trie sur cette colonne : une valeur tapée dans le panneau
    // ferait sinon remonter la note en tête sans que rien de la note n'ait bougé.
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, templated(&space_id), t0()).unwrap();

    let saved =
        set_placeholder_values(&mut connection, &created.id, &values(&[("host", "db")])).unwrap();

    assert_eq!(saved.updated_at, t0());
    assert_eq!(list(&mut connection).unwrap()[0].updated_at, t0());
}

#[test]
fn writing_the_values_replaces_the_whole_set() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, templated(&space_id), t0()).unwrap();
    set_placeholder_values(
        &mut connection,
        &created.id,
        &values(&[("host", "db"), ("port", "6543")]),
    )
    .unwrap();

    // Ce qui n'est plus envoyé est ce que l'utilisateur a effacé : le laisser
    // en base continuerait de remplir le texte avec.
    set_placeholder_values(&mut connection, &created.id, &values(&[("host", "db")])).unwrap();

    assert_eq!(
        list(&mut connection).unwrap()[0].placeholder_values,
        values(&[("host", "db")])
    );
}

#[test]
fn a_value_whose_token_left_the_content_stays_stored_but_out_of_the_fields() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, templated(&space_id), t0()).unwrap();
    set_placeholder_values(&mut connection, &created.id, &values(&[("host", "db")])).unwrap();

    let renamed = update(
        &mut connection,
        &created.id,
        &NotePatch {
            content: Some("psql -h {{hostname}}".to_string()),
            ..NotePatch::default()
        },
        t1(),
    )
    .unwrap();

    // La valeur survit — le renommage peut être une faute de frappe — mais
    // c'est le texte qui dit quels champs existent.
    assert_eq!(renamed.placeholder_values, values(&[("host", "db")]));
    let fields = decorate(renamed, t1()).placeholders;
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].name, "hostname");
    assert!(fields[0].value.is_empty());
}

#[test]
fn filling_a_trashed_note_is_refused() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, templated(&space_id), t0()).unwrap();
    delete(&mut connection, &created.id, t1()).unwrap();

    let error = set_placeholder_values(&mut connection, &created.id, &values(&[("host", "db")]))
        .unwrap_err();

    assert!(matches!(error, StorageError::NoteNotFound(_)));
}

#[test]
fn purging_removes_the_note_and_its_values_for_good() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let created = create(&mut connection, templated(&space_id), t0()).unwrap();
    set_placeholder_values(&mut connection, &created.id, &values(&[("host", "db")])).unwrap();
    delete(&mut connection, &created.id, t1()).unwrap();

    purge(&mut connection, std::slice::from_ref(&created.id)).unwrap();

    // Comme pour les items : le `ON DELETE CASCADE` n'agit que si
    // `PRAGMA foreign_keys` est posé sur la connexion.
    assert_eq!(
        note_placeholders::table
            .count()
            .get_result::<i64>(&mut connection)
            .unwrap(),
        0
    );
}

// --- Actions en masse -------------------------------------------------------

#[test]
fn moving_a_selection_leaves_the_notes_already_there_untouched() {
    let mut connection = open_in_memory().unwrap();
    let source = space(&mut connection, "Perso");
    let target = space(&mut connection, "Boulot");
    let moved = create(&mut connection, draft(&source), t0()).unwrap();
    let settled = create(&mut connection, draft(&target), t0()).unwrap();

    let count = move_many(
        &mut connection,
        &[moved.id.clone(), settled.id.clone()],
        &target,
        t1(),
    )
    .unwrap();

    // Celle qui y était déjà n'est pas comptée, et son `updated_at` ne bouge pas.
    assert_eq!(count, 1);
    let listed = list(&mut connection).unwrap();
    assert!(listed.iter().all(|note| note.space_id == target));
    let untouched = listed.iter().find(|note| note.id == settled.id).unwrap();
    assert_eq!(untouched.updated_at, t0());
}

#[test]
fn moving_to_an_unknown_space_is_refused_for_the_whole_batch() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let note = create(&mut connection, draft(&space_id), t0()).unwrap();

    let error = move_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        "ghost",
        t1(),
    )
    .unwrap_err();

    assert!(matches!(error, StorageError::SpaceNotFound(_)));
    assert_eq!(list(&mut connection).unwrap()[0].space_id, space_id);
}

#[test]
fn tagging_a_selection_adds_without_replacing() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let note = create(&mut connection, draft(&space_id), t0()).unwrap();

    let count = tag_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        &["urgent".to_string()],
        t1(),
    )
    .unwrap();

    assert_eq!(count, 1);
    assert_eq!(
        list(&mut connection).unwrap()[0].tags,
        ["api", "auth", "urgent"]
    );
}

#[test]
fn tagging_twice_does_not_duplicate_the_tag() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let note = create(&mut connection, draft(&space_id), t0()).unwrap();

    // La clé primaire de `note_tags` est NOCASE : la seconde pose est ignorée.
    tag_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        &["Auth".to_string()],
        t1(),
    )
    .unwrap();

    assert_eq!(list(&mut connection).unwrap()[0].tags, ["api", "auth"]);
}

// --- Gestion globale des tags -----------------------------------------------

#[test]
fn every_tag_is_listed_with_the_number_of_notes_carrying_it() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();
    create(&mut connection, draft(&space_id), t0()).unwrap();

    assert_eq!(
        tag_usage(&mut connection).unwrap(),
        [("api".to_string(), 2), ("auth".to_string(), 2)]
    );
}

#[test]
fn a_trashed_note_no_longer_counts_towards_its_tags() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let kept = create(&mut connection, draft(&space_id), t0()).unwrap();
    let thrown = create(&mut connection, draft(&space_id), t0()).unwrap();
    delete(&mut connection, &thrown.id, t1()).unwrap();

    let usage = tag_usage(&mut connection).unwrap();

    assert_eq!(usage[0], ("api".to_string(), 1));
    assert_eq!(list(&mut connection).unwrap()[0].id, kept.id);
}

#[test]
fn renaming_a_tag_onto_an_existing_one_merges_them() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let note = create(&mut connection, draft(&space_id), t0()).unwrap();

    // La note porte déjà « auth » : un `UPDATE` violerait la clé primaire.
    let touched = retag(&mut connection, &["api".to_string()], "auth").unwrap();

    assert_eq!(touched, 1);
    assert_eq!(list(&mut connection).unwrap()[0].tags, ["auth"]);
    assert_eq!(note.tags.len(), 2);
}

#[test]
fn merging_several_tags_keeps_one_note_entry_each() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    retag(
        &mut connection,
        &["api".to_string(), "auth".to_string()],
        "backend",
    )
    .unwrap();

    assert_eq!(list(&mut connection).unwrap()[0].tags, ["backend"]);
}

#[test]
fn correcting_the_case_of_a_tag_does_not_erase_it() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    // La cible figure parmi les sources : supprimer « auth » après avoir écrit
    // « Auth » effacerait les deux, la collation étant NOCASE.
    retag(&mut connection, &["auth".to_string()], "Auth").unwrap();

    assert_eq!(list(&mut connection).unwrap()[0].tags, ["api", "Auth"]);
}

#[test]
fn dropping_a_tag_leaves_the_notes_in_place() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    assert_eq!(drop_tag(&mut connection, "auth").unwrap(), 1);

    let listed = list(&mut connection).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].tags, ["api"]);
}

#[test]
fn a_global_retag_does_not_float_the_corpus_to_the_top_of_the_canvas() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    create(&mut connection, draft(&space_id), t0()).unwrap();

    retag(&mut connection, &["auth".to_string()], "identity").unwrap();

    // Le canevas trie sur `updated_at` : le toucher remonterait toutes les
    // notes que personne n'a rouvertes.
    assert_eq!(list(&mut connection).unwrap()[0].updated_at, t0());
}

// --- Export et import -------------------------------------------------------

#[test]
fn an_export_reads_every_live_note_of_a_space() {
    let mut connection = open_in_memory().unwrap();
    let perso = space(&mut connection, "Perso");
    let boulot = space(&mut connection, "Boulot");
    create(&mut connection, draft(&perso), t0()).unwrap();
    let elsewhere = create(&mut connection, draft(&boulot), t0()).unwrap();
    let thrown = create(&mut connection, draft(&perso), t0()).unwrap();
    delete(&mut connection, &thrown.id, t1()).unwrap();

    let exported = all(&mut connection, Some(&perso)).unwrap();

    assert_eq!(exported.len(), 1);
    assert_eq!(exported[0].tags, ["api", "auth"]);
    assert_eq!(all(&mut connection, None).unwrap().len(), 2);
    assert!(
        all(&mut connection, None)
            .unwrap()
            .iter()
            .any(|note| note.id == elsewhere.id)
    );
}

#[test]
fn an_imported_note_keeps_its_identifier_and_its_dates() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let mut note = create(&mut connection, draft(&space_id), t0()).unwrap();
    note.id = "imported".to_string();

    assert!(insert_imported(&mut connection, &note).unwrap());

    let found = all(&mut connection, None)
        .unwrap()
        .into_iter()
        .find(|candidate| candidate.id == "imported")
        .unwrap();
    assert_eq!(found.created_at, t0());
    assert_eq!(found.tags, ["api", "auth"]);
}

#[test]
fn importing_the_same_note_twice_leaves_the_first_one_alone() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let mut note = create(&mut connection, draft(&space_id), t0()).unwrap();
    note.title = "Écrasé ?".to_string();

    // Même identifiant : l'import doit compter la note comme ignorée, pas
    // remplacer ce que la machine contient déjà.
    assert!(!insert_imported(&mut connection, &note).unwrap());
    assert_eq!(list(&mut connection).unwrap()[0].title, "Titre");
}

#[test]
fn sharing_a_selection_reads_the_notes_it_names() {
    let mut connection = open_in_memory().unwrap();
    let space_id = space(&mut connection, "Perso");
    let first = create(&mut connection, draft(&space_id), t0()).unwrap();
    create(&mut connection, draft(&space_id), t0()).unwrap();

    let selected = by_ids(&mut connection, std::slice::from_ref(&first.id)).unwrap();

    assert_eq!(selected.len(), 1);
    assert_eq!(selected[0].id, first.id);
    assert!(by_ids(&mut connection, &[]).unwrap().is_empty());
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

    diesel::update(devbox_lib::db::schema::notes::table.find(&created.id))
        .set(devbox_lib::db::schema::notes::created_at.eq("pas une date"))
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

    let stored: String = devbox_lib::db::schema::notes::table
        .find(&created.id)
        .select(devbox_lib::db::schema::notes::updated_at)
        .first(&mut connection)
        .unwrap();

    assert_eq!(stored, "2026-07-25T09:00:00.000Z");
}
