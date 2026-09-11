//! Spaces read and written against a real database — deletion included, which
//! moves the notes out before dropping, on pain of a cascade.

use diesel::SqliteConnection;
use diesel::prelude::*;

use devbox_lib::db::open_in_memory;
use devbox_lib::db::schema::notes;
use devbox_lib::error::StorageError;
use devbox_lib::spaces::store::{create, delete, exists, list, rename};

const T0: &str = "2026-07-25T09:00:00.000Z";

/// A note written straight into the database: these tests are about spaces, and
/// going through `notes::create` would drag its own rules in.
fn note_in(connection: &mut SqliteConnection, space_id: &str) {
    diesel::insert_into(notes::table)
        .values((
            notes::id.eq("n-1"),
            notes::space_id.eq(space_id),
            notes::title.eq("A"),
            notes::language.eq("txt"),
            notes::content.eq(""),
            notes::source.eq(""),
            notes::pinned.eq(false),
            notes::created_at.eq(T0),
            notes::updated_at.eq(T0),
            notes::lifecycle_kind.eq("permanent"),
        ))
        .execute(connection)
        .unwrap();
}

fn names(connection: &mut SqliteConnection) -> Vec<String> {
    list(connection)
        .unwrap()
        .into_iter()
        .map(|space| space.name)
        .collect()
}

#[test]
fn a_created_space_is_listed_back() {
    let mut connection = open_in_memory().unwrap();

    let created = create(&mut connection, "Perso").unwrap();
    let listed = list(&mut connection).unwrap();

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);
    assert_eq!(listed[0].name, "Perso");
}

#[test]
fn each_space_gets_its_own_identifier() {
    let mut connection = open_in_memory().unwrap();

    let first = create(&mut connection, "Perso").unwrap();
    let second = create(&mut connection, "Boulot").unwrap();

    assert_ne!(first.id, second.id);
}

#[test]
fn spaces_are_listed_in_name_order() {
    let mut connection = open_in_memory().unwrap();

    create(&mut connection, "Veille").unwrap();
    create(&mut connection, "Boulot").unwrap();
    create(&mut connection, "perso").unwrap();

    // Case-insensitive: a BINARY sort would file "perso" after "Veille".
    assert_eq!(names(&mut connection), ["Boulot", "perso", "Veille"]);
}

#[test]
fn a_duplicate_name_is_refused_regardless_of_case() {
    let mut connection = open_in_memory().unwrap();
    create(&mut connection, "Perso").unwrap();

    let error = create(&mut connection, "PERSO").unwrap_err();

    assert!(matches!(error, StorageError::DuplicateSpaceName(_)));
    assert_eq!(list(&mut connection).unwrap().len(), 1);
}

#[test]
fn exists_distinguishes_known_from_unknown_identifiers() {
    let mut connection = open_in_memory().unwrap();
    let space = create(&mut connection, "Perso").unwrap();

    assert!(exists(&mut connection, &space.id).unwrap());
    assert!(!exists(&mut connection, "inconnu").unwrap());
}

#[test]
fn a_renamed_space_keeps_its_identifier() {
    let mut connection = open_in_memory().unwrap();
    let space = create(&mut connection, "Perso").unwrap();

    let renamed = rename(&mut connection, &space.id, "Personnel").unwrap();

    // The id is what the notes point at: changing it would orphan them.
    assert_eq!(renamed.id, space.id);
    assert_eq!(renamed.name, "Personnel");
    assert_eq!(list(&mut connection).unwrap()[0].name, "Personnel");
}

#[test]
fn a_space_can_be_renamed_to_a_different_case_of_its_own_name() {
    let mut connection = open_in_memory().unwrap();
    let space = create(&mut connection, "perso").unwrap();

    // The uniqueness check is COLLATE NOCASE: without excluding the row
    // being renamed, it would see the space as a duplicate of itself.
    let renamed = rename(&mut connection, &space.id, "Perso").unwrap();

    assert_eq!(renamed.name, "Perso");
}

#[test]
fn renaming_onto_another_space_name_is_refused() {
    let mut connection = open_in_memory().unwrap();
    create(&mut connection, "Boulot").unwrap();
    let space = create(&mut connection, "Perso").unwrap();

    let error = rename(&mut connection, &space.id, "BOULOT").unwrap_err();

    assert!(matches!(error, StorageError::DuplicateSpaceName(_)));
    assert_eq!(list(&mut connection).unwrap()[1].name, "Perso");
}

#[test]
fn renaming_an_unknown_space_reports_an_error() {
    let mut connection = open_in_memory().unwrap();

    let error = rename(&mut connection, "inconnu", "Perso").unwrap_err();

    assert!(matches!(error, StorageError::SpaceNotFound(_)));
}

#[test]
fn deleting_a_space_moves_its_notes_to_the_target() {
    let mut connection = open_in_memory().unwrap();
    let doomed = create(&mut connection, "Perso").unwrap();
    let refuge = create(&mut connection, "Boulot").unwrap();
    note_in(&mut connection, &doomed.id);

    delete(&mut connection, &doomed.id, &refuge.id).unwrap();

    // The schema cascades on space deletion; the move must happen first or
    // the note disappears with its space.
    let space_id = notes::table
        .find("n-1")
        .select(notes::space_id)
        .first::<String>(&mut connection)
        .unwrap();
    assert_eq!(space_id, refuge.id);
    assert_eq!(list(&mut connection).unwrap().len(), 1);
}

#[test]
fn moving_notes_out_of_a_deleted_space_does_not_touch_their_timestamps() {
    let mut connection = open_in_memory().unwrap();
    let doomed = create(&mut connection, "Perso").unwrap();
    let refuge = create(&mut connection, "Boulot").unwrap();
    note_in(&mut connection, &doomed.id);

    delete(&mut connection, &doomed.id, &refuge.id).unwrap();

    // The canvas orders on updated_at: refreshing it would float the whole
    // absorbed space to the top as if every note had just been edited.
    let updated_at = notes::table
        .find("n-1")
        .select(notes::updated_at)
        .first::<String>(&mut connection)
        .unwrap();
    assert_eq!(updated_at, T0);
}

#[test]
fn deleting_an_empty_space_leaves_the_others_alone() {
    let mut connection = open_in_memory().unwrap();
    let doomed = create(&mut connection, "Perso").unwrap();
    let refuge = create(&mut connection, "Boulot").unwrap();

    delete(&mut connection, &doomed.id, &refuge.id).unwrap();

    assert_eq!(names(&mut connection), ["Boulot"]);
}

#[test]
fn deleting_an_unknown_space_reports_an_error() {
    let mut connection = open_in_memory().unwrap();
    let refuge = create(&mut connection, "Boulot").unwrap();

    let error = delete(&mut connection, "inconnu", &refuge.id).unwrap_err();

    assert!(matches!(error, StorageError::SpaceNotFound(_)));
}

#[test]
fn deleting_into_an_unknown_space_changes_nothing() {
    let mut connection = open_in_memory().unwrap();
    let doomed = create(&mut connection, "Perso").unwrap();
    note_in(&mut connection, &doomed.id);

    let error = delete(&mut connection, &doomed.id, "inconnu").unwrap_err();

    // Rolling back matters here: a half-applied delete would have taken the
    // notes with it.
    assert!(matches!(error, StorageError::SpaceNotFound(_)));
    assert_eq!(list(&mut connection).unwrap().len(), 1);
    assert_eq!(
        notes::table
            .count()
            .get_result::<i64>(&mut connection)
            .unwrap(),
        1
    );
}
