use chrono::{DateTime, Utc};
use diesel::SqliteConnection;

use devbox_lib::db::{iso8601, open_in_memory};
use devbox_lib::notes::checklist::NoteKind;
use devbox_lib::notes::language::Language;
use devbox_lib::notes::model::{NoteDraft, NoteLifecycle};
use devbox_lib::notes::store as notes;
use devbox_lib::spaces::store as spaces;
use devbox_lib::transfer::bundle::{collect, merge};
use devbox_lib::transfer::model::{self, Bundle, IncomingBundle};

fn t0() -> DateTime<Utc> {
    iso8601::parse("2026-07-25T09:00:00.000Z").unwrap()
}

fn draft(space_id: &str, title: &str) -> NoteDraft {
    NoteDraft {
        space_id: space_id.to_string(),
        title: title.to_string(),
        language: Language::Sql,
        content: "select 1".to_string(),
        source: "API / Auth".to_string(),
        tags: vec!["auth".to_string()],
        pinned: false,
        lifecycle: NoteLifecycle::Permanent,
        kind: NoteKind::Snippet,
        items: Vec::new(),
    }
}

/// A populated database, the way a user would have one.
fn library() -> SqliteConnection {
    let mut connection = open_in_memory().unwrap();
    let personal = spaces::create(&mut connection, "Personal").unwrap().id;
    let boulot = spaces::create(&mut connection, "Boulot").unwrap().id;
    notes::create(&mut connection, draft(&personal, "Première"), t0()).unwrap();
    notes::create(&mut connection, draft(&boulot, "Seconde"), t0()).unwrap();

    connection
}

fn exported(connection: &mut SqliteConnection) -> Bundle {
    let all = notes::all(connection, None).unwrap();
    collect(connection, all).unwrap()
}

/// The file as it is really written and read back, serialization included.
fn round_tripped(bundle: &Bundle) -> IncomingBundle {
    model::read_bundle(&serde_json::to_string(bundle).unwrap()).unwrap()
}

/// The file a newer DevBox would write: the same bundle, with a value in `field`
/// that this build has never heard of.
fn written_by_a_newer_version(bundle: &Bundle, field: &str, value: &str) -> IncomingBundle {
    let mut json: serde_json::Value = serde_json::to_value(bundle).unwrap();
    json["notes"][0][field] = serde_json::Value::String(value.to_string());

    model::read_bundle(&json.to_string()).unwrap()
}

#[test]
fn a_library_moves_whole_to_another_machine() {
    let mut source = library();
    let bundle = round_tripped(&exported(&mut source));

    let mut target = open_in_memory().unwrap();
    let report = merge(&mut target, bundle).unwrap();

    assert_eq!(report.notes_imported, 2);
    assert_eq!(report.spaces_created, 2);
    assert_eq!(report.notes_skipped, 0);

    let arrived = notes::all(&mut target, None).unwrap();
    let mut titles: Vec<&str> = arrived.iter().map(|note| note.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(titles, ["Première", "Seconde"]);
    assert_eq!(arrived[0].content, "select 1");
    assert_eq!(arrived[0].tags, ["auth"]);
    assert_eq!(arrived[0].created_at, t0());
    assert_eq!(spaces::list(&mut target).unwrap().len(), 2);
}

#[test]
fn only_the_spaces_actually_cited_travel() {
    let mut source = library();
    let personal = spaces::list(&mut source).unwrap()[1].id.clone();
    let single = notes::all(&mut source, Some(&personal)).unwrap();

    let bundle = collect(&mut source, single).unwrap();

    assert_eq!(bundle.spaces.len(), 1);
    assert_eq!(bundle.notes.len(), 1);
}

#[test]
fn importing_the_same_file_twice_adds_nothing_the_second_time() {
    let mut source = library();
    let file = exported(&mut source);

    let mut target = open_in_memory().unwrap();
    merge(&mut target, round_tripped(&file)).unwrap();
    let second = merge(&mut target, round_tripped(&file)).unwrap();

    assert_eq!(second.notes_imported, 0);
    assert_eq!(second.notes_skipped, 2);
    assert_eq!(second.spaces_created, 0);
    assert_eq!(notes::all(&mut target, None).unwrap().len(), 2);
}

#[test]
fn reimporting_into_the_base_it_came_from_changes_nothing() {
    let mut library = library();
    let bundle = round_tripped(&exported(&mut library));

    let report = merge(&mut library, bundle).unwrap();

    assert_eq!(report.notes_imported, 0);
    assert_eq!(report.notes_skipped, 2);
    assert_eq!(notes::all(&mut library, None).unwrap().len(), 2);
}

#[test]
fn a_space_of_the_same_name_is_reused_rather_than_duplicated() {
    let mut source = library();
    let bundle = round_tripped(&exported(&mut source));

    let mut target = open_in_memory().unwrap();
    spaces::create(&mut target, "PERSONAL").unwrap();

    let report = merge(&mut target, bundle).unwrap();

    assert_eq!(report.spaces_created, 1);
    assert_eq!(spaces::list(&mut target).unwrap().len(), 2);
}

#[test]
fn a_note_whose_space_is_missing_from_the_file_is_skipped_not_misfiled() {
    let mut source = library();
    let mut incoming = round_tripped(&exported(&mut source));
    incoming.bundle.spaces.clear();

    let mut target = open_in_memory().unwrap();
    let report = merge(&mut target, incoming).unwrap();

    assert_eq!(report.notes_imported, 0);
    assert_eq!(report.notes_skipped, 2);
}

#[test]
fn a_trashed_note_does_not_leave_with_the_export() {
    let mut source = library();
    let thrown = notes::all(&mut source, None).unwrap()[0].id.clone();
    notes::trash::trash(&mut source, &thrown, t0()).unwrap();

    let bundle = exported(&mut source);

    assert_eq!(bundle.notes.len(), 1);
}

/// The case the whole guard exists for: one note in an unknown language must not
/// cost the other 499.
#[test]
fn a_note_in_an_unknown_language_arrives_without_taking_the_file_down() {
    let mut source = library();
    let file = exported(&mut source);

    let mut target = open_in_memory().unwrap();
    let report = merge(
        &mut target,
        written_by_a_newer_version(&file, "language", "rust"),
    )
    .unwrap();

    assert_eq!(report.notes_imported, 2);
    assert_eq!(report.notes_degraded, 1);

    let arrived = notes::all(&mut target, None).unwrap();
    assert_eq!(arrived.len(), 2);
    assert!(
        arrived
            .iter()
            .any(|note| note.language == Language::default())
    );
}

#[test]
fn a_note_of_an_unknown_kind_is_degraded_the_same_way() {
    let mut source = library();
    let file = exported(&mut source);

    let mut target = open_in_memory().unwrap();
    let report = merge(
        &mut target,
        written_by_a_newer_version(&file, "kind", "table"),
    )
    .unwrap();

    assert_eq!(report.notes_imported, 2);
    assert_eq!(report.notes_degraded, 1);
    assert!(
        notes::all(&mut target, None)
            .unwrap()
            .iter()
            .all(|note| note.kind == NoteKind::default())
    );
}

/// The count follows what came in, not what the file carried: the second import
/// adds nothing, so it has nothing to report as degraded either.
#[test]
fn a_degraded_note_is_counted_once_and_not_again_on_a_second_import() {
    let mut source = library();
    let file = exported(&mut source);

    let mut target = open_in_memory().unwrap();
    merge(
        &mut target,
        written_by_a_newer_version(&file, "language", "rust"),
    )
    .unwrap();

    let second = merge(
        &mut target,
        written_by_a_newer_version(&file, "language", "rust"),
    )
    .unwrap();

    assert_eq!(second.notes_imported, 0);
    assert_eq!(second.notes_degraded, 0);
}
