//! The folder as data: a region of a space that notes are filed into, and that never
//! takes a note with it when it goes.

use chrono::{DateTime, Utc};

use devbox_lib::db::{Library, iso8601, open_in_memory};
use devbox_lib::error::StorageError;
use devbox_lib::folders::model::{FolderColour, NoteFiling};
use devbox_lib::folders::store::{
    create, delete, file_many, list, recolour, rename, restore_filings,
};
use devbox_lib::notes::checklist::NoteKind;
use devbox_lib::notes::language::Language;
use devbox_lib::notes::model::{Note, NoteDraft, NoteLifecycle, NotePatch};
use devbox_lib::notes::store::{create as create_note, update};
use devbox_lib::spaces::store as spaces;

fn at(iso: &str) -> DateTime<Utc> {
    iso8601::parse(iso).expect("tests write valid instants")
}

fn t0() -> DateTime<Utc> {
    at("2026-07-25T09:00:00.000Z")
}

fn t1() -> DateTime<Utc> {
    at("2026-07-25T10:00:00.000Z")
}

fn space(connection: &mut Library, name: &str) -> String {
    spaces::create(connection, name).unwrap().id
}

fn draft(space_id: &str) -> NoteDraft {
    NoteDraft {
        space_id: space_id.to_string(),
        folder_id: None,
        title: "Titre".to_string(),
        language: Language::Txt,
        content: "Contenu".to_string(),
        source: String::new(),
        tags: Vec::new(),
        pinned: false,
        lifecycle: NoteLifecycle::Permanent,
        kind: NoteKind::Snippet,
        items: Vec::new(),
    }
}

fn note_in(connection: &mut Library, space_id: &str) -> Note {
    create_note(connection, draft(space_id), t0()).unwrap()
}

fn folder_of(connection: &mut Library, note_id: &str) -> Option<String> {
    use devbox_lib::db::schema::notes;
    use diesel::prelude::*;

    notes::table
        .find(note_id)
        .select(notes::folder_id)
        .first::<Option<String>>(connection.db())
        .unwrap()
}

fn updated_at_of(connection: &mut Library, note_id: &str) -> String {
    use devbox_lib::db::schema::notes;
    use diesel::prelude::*;

    notes::table
        .find(note_id)
        .select(notes::updated_at)
        .first::<String>(connection.db())
        .unwrap()
}

fn names(connection: &mut Library, space_id: &str) -> Vec<String> {
    list(connection, Some(space_id))
        .unwrap()
        .into_iter()
        .map(|folder| folder.name)
        .collect()
}

#[test]
fn a_created_folder_is_listed_back_inside_its_space() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let other = space(&mut connection, "Veille");

    let created = create(&mut connection, &sql, "Perf", t0()).unwrap();
    create(&mut connection, &other, "Liens", t0()).unwrap();

    let listed = list(&mut connection, Some(&sql)).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);
    assert_eq!(listed[0].name, "Perf");
    assert_eq!(listed[0].space_id, sql);
}

/// Reading order, which is the order the board lays its zones out in — and which a
/// rename must not reshuffle.
#[test]
fn folders_come_back_in_the_order_they_were_made() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");

    create(
        &mut connection,
        &sql,
        "Migrations",
        at("2026-07-25T09:00:00.000Z"),
    )
    .unwrap();
    create(
        &mut connection,
        &sql,
        "Perf",
        at("2026-07-25T09:30:00.000Z"),
    )
    .unwrap();
    let reporting = create(
        &mut connection,
        &sql,
        "Reporting",
        at("2026-07-25T10:00:00.000Z"),
    )
    .unwrap();

    rename(&mut connection, &reporting.id, "Analytics").unwrap();

    assert_eq!(
        names(&mut connection, &sql),
        ["Migrations", "Perf", "Analytics"]
    );
}

/// Assigned rather than chosen: drawing a folder stays one gesture, and two made back
/// to back must not come out the same colour.
#[test]
fn the_palette_rotates_so_neighbours_differ() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");

    let first = create(&mut connection, &sql, "Migrations", t0()).unwrap();
    let second = create(&mut connection, &sql, "Perf", t0()).unwrap();

    assert_ne!(first.colour, second.colour);
    assert_eq!(first.colour, FolderColour::nth(0));
    assert_eq!(second.colour, FolderColour::nth(1));
}

/// Each space starts the rotation over: its own board is what a colour tells apart.
#[test]
fn the_rotation_is_counted_inside_one_space() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let veille = space(&mut connection, "Veille");

    create(&mut connection, &sql, "Migrations", t0()).unwrap();
    create(&mut connection, &sql, "Perf", t0()).unwrap();
    let elsewhere = create(&mut connection, &veille, "Liens", t0()).unwrap();

    assert_eq!(elsewhere.colour, FolderColour::nth(0));
}

#[test]
fn a_folder_can_be_given_another_colour() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let folder = create(&mut connection, &sql, "Perf", t0()).unwrap();

    let recoloured = recolour(&mut connection, &folder.id, FolderColour::Red).unwrap();

    assert_eq!(recoloured.colour, FolderColour::Red);
    assert_eq!(
        list(&mut connection, Some(&sql)).unwrap()[0].colour,
        FolderColour::Red
    );
}

#[test]
fn two_folders_of_one_space_cannot_share_a_name_whatever_the_case() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    create(&mut connection, &sql, "Perf", t0()).unwrap();

    let refused = create(&mut connection, &sql, "perf", t0());

    assert!(matches!(refused, Err(StorageError::DuplicateFolderName(_))));
    assert_eq!(names(&mut connection, &sql).len(), 1);
}

/// Uniqueness is per space, not per library: two spaces both wanting a "Perf" is the
/// normal case, not a collision.
#[test]
fn the_same_name_is_free_again_in_another_space() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let veille = space(&mut connection, "Veille");
    create(&mut connection, &sql, "Perf", t0()).unwrap();

    assert!(create(&mut connection, &veille, "Perf", t0()).is_ok());
}

#[test]
fn correcting_the_case_of_a_name_is_not_a_duplicate_of_itself() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let folder = create(&mut connection, &sql, "perf", t0()).unwrap();

    let renamed = rename(&mut connection, &folder.id, "Perf").unwrap();

    assert_eq!(renamed.name, "Perf");
}

#[test]
fn a_folder_of_an_unknown_space_is_refused() {
    let mut connection = open_in_memory().unwrap();

    let refused = create(&mut connection, "nowhere", "Perf", t0());

    assert!(matches!(refused, Err(StorageError::SpaceNotFound(_))));
}

#[test]
fn filing_a_note_answers_where_it_came_from() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let note = note_in(&mut connection, &sql);

    let filed = file_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    assert_eq!(
        filed,
        [NoteFiling {
            note_id: note.id.clone(),
            folder_id: None
        }]
    );
    assert_eq!(folder_of(&mut connection, &note.id), Some(perf.id));
}

#[test]
fn filing_with_no_folder_takes_a_note_back_out() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let note = note_in(&mut connection, &sql);
    file_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    let unfiled = file_many(&mut connection, std::slice::from_ref(&note.id), None, t1()).unwrap();

    assert_eq!(unfiled[0].folder_id, Some(perf.id));
    assert_eq!(folder_of(&mut connection, &note.id), None);
}

/// A batch reports what it actually changed, so the undo cannot unfile a note the batch
/// never touched.
#[test]
fn a_note_already_in_the_folder_is_not_reported_as_filed() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let already = note_in(&mut connection, &sql);
    let moving = note_in(&mut connection, &sql);
    file_many(
        &mut connection,
        std::slice::from_ref(&already.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    let filed = file_many(
        &mut connection,
        &[already.id.clone(), moving.id.clone()],
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    assert_eq!(filed.len(), 1);
    assert_eq!(filed[0].note_id, moving.id);
}

/// A folder belongs to one space, so filing across spaces would show a chip the space
/// switcher can never reach.
#[test]
fn a_note_of_another_space_is_left_where_it_is() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let veille = space(&mut connection, "Veille");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let elsewhere = note_in(&mut connection, &veille);

    let filed = file_many(
        &mut connection,
        std::slice::from_ref(&elsewhere.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    assert!(filed.is_empty());
    assert_eq!(folder_of(&mut connection, &elsewhere.id), None);
}

#[test]
fn undoing_a_filing_puts_every_note_back_where_it_was() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let migrations = create(&mut connection, &sql, "Migrations", t0()).unwrap();
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let loose = note_in(&mut connection, &sql);
    let filed = note_in(&mut connection, &sql);
    file_many(
        &mut connection,
        std::slice::from_ref(&filed.id),
        Some(&migrations.id),
        t1(),
    )
    .unwrap();

    let batch = file_many(
        &mut connection,
        &[loose.id.clone(), filed.id.clone()],
        Some(&perf.id),
        t1(),
    )
    .unwrap();
    restore_filings(&mut connection, &batch).unwrap();

    assert_eq!(folder_of(&mut connection, &loose.id), None);
    assert_eq!(folder_of(&mut connection, &filed.id), Some(migrations.id));
}

/// ⚠️ Undoing is not editing, and the canvas sorts on that column.
#[test]
fn undoing_a_filing_leaves_the_instant_alone() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let note = note_in(&mut connection, &sql);

    let batch = file_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();
    restore_filings(&mut connection, &batch).unwrap();

    assert_eq!(
        updated_at_of(&mut connection, &note.id),
        iso8601::format(t1())
    );
}

/// The one thing a folder must never do.
#[test]
fn deleting_a_folder_leaves_its_notes_loose_rather_than_deleting_them() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let note = note_in(&mut connection, &sql);
    file_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    delete(&mut connection, &perf.id).unwrap();

    assert!(list(&mut connection, Some(&sql)).unwrap().is_empty());
    assert_eq!(folder_of(&mut connection, &note.id), None);
}

#[test]
fn deleting_an_unknown_folder_says_so_rather_than_answering_ok() {
    let mut connection = open_in_memory().unwrap();

    assert!(matches!(
        delete(&mut connection, "nowhere"),
        Err(StorageError::FolderNotFound(_))
    ));
}

/// The folders go with their space through the cascade; their notes went to the refuge
/// first, and come out of it loose.
#[test]
fn deleting_a_space_takes_its_folders_and_unfiles_the_notes_it_hands_over() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let refuge = space(&mut connection, "Veille");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let note = note_in(&mut connection, &sql);
    file_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    spaces::delete(&mut connection, &sql, &refuge).unwrap();

    assert!(list(&mut connection, Some(&sql)).unwrap().is_empty());
    assert_eq!(folder_of(&mut connection, &note.id), None);
}

/// ⚠️ The chip would otherwise name a folder the space switcher can never reach.
#[test]
fn moving_a_note_to_another_space_takes_it_out_of_its_folder() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let veille = space(&mut connection, "Veille");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let note = note_in(&mut connection, &sql);
    file_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    let patch = NotePatch {
        space_id: Some(veille.clone()),
        ..NotePatch::default()
    };
    update(&mut connection, &note.id, &patch, t1()).unwrap();

    assert_eq!(folder_of(&mut connection, &note.id), None);
}

/// Editing a note is not refiling it.
#[test]
fn a_patch_that_says_nothing_about_the_space_leaves_the_folder_alone() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();
    let note = note_in(&mut connection, &sql);
    file_many(
        &mut connection,
        std::slice::from_ref(&note.id),
        Some(&perf.id),
        t1(),
    )
    .unwrap();

    let patch = NotePatch {
        title: Some("Autre".to_string()),
        ..NotePatch::default()
    };
    update(&mut connection, &note.id, &patch, t1()).unwrap();

    assert_eq!(folder_of(&mut connection, &note.id), Some(perf.id));
}

/// A note created inside a folder arrives already filed — one of the two places that do.
#[test]
fn a_draft_can_name_the_folder_it_is_born_in() {
    let mut connection = open_in_memory().unwrap();
    let sql = space(&mut connection, "SQL");
    let perf = create(&mut connection, &sql, "Perf", t0()).unwrap();

    let born = create_note(
        &mut connection,
        NoteDraft {
            folder_id: Some(perf.id.clone()),
            ..draft(&sql)
        },
        t0(),
    )
    .unwrap();

    assert_eq!(born.folder_id, Some(perf.id));
}
