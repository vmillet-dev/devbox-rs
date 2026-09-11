//! The JSON shape of everything that crosses the Tauri bridge.
//!
//! Gathered here rather than scattered beside each type: it is **one** contract,
//! and the compiler checks none of it.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};

use devbox_lib::attachments::model::Attachment;
use devbox_lib::db::iso8601;
use devbox_lib::error::StorageError;
use devbox_lib::error::ValidationError;
use devbox_lib::error::{AppError, ErrorCode};
use devbox_lib::notes::checklist::{ChecklistItem, NoteKind};
use devbox_lib::notes::language::Language;
use devbox_lib::notes::model::{
    DisplayNote, Note, NoteDraft, NoteLifecycle, NotePatch, TagUsage, decorate,
};
use devbox_lib::notes::trash;
use devbox_lib::notes::view::{NoteFilter, NoteSection, NoteSectionKey, NotesQuery, NotesView};
use devbox_lib::spaces::model::{Space, SpaceDraft};
use devbox_lib::transfer;
use devbox_lib::transfer::model::{Bundle, ImportReport};

const NOW: &str = "2026-07-25T09:00:00.000Z";

fn at(iso: &str) -> DateTime<Utc> {
    iso8601::parse(iso).expect("les tests écrivent des instants valides")
}

fn sample() -> Note {
    Note {
        id: "n-1".to_string(),
        space_id: "s-1".to_string(),
        title: "Titre".to_string(),
        language: Language::Txt,
        content: "Contenu".to_string(),
        source: String::new(),
        tags: vec!["auth".to_string()],
        pinned: false,
        created_at: at(NOW),
        updated_at: at(NOW),
        lifecycle: NoteLifecycle::Permanent,
        kind: NoteKind::Snippet,
        items: Vec::new(),
        placeholder_values: BTreeMap::new(),
    }
}

fn displayed(note: Note) -> DisplayNote {
    decorate(note, at(NOW))
}

// --- Note ------------------------------------------------------------------

#[test]
fn a_note_serialises_with_camel_case_keys() {
    let json = serde_json::to_value(sample()).unwrap();

    // serde's default would emit the snake_case names and the front would read
    // `undefined` where it expects a value.
    assert!(json.get("spaceId").is_some());
    assert!(json.get("createdAt").is_some());
    assert!(json.get("updatedAt").is_some());
    assert!(json.get("space_id").is_none());
    assert!(json.get("created_at").is_none());
}

#[test]
fn a_permanent_lifecycle_serialises_as_a_tagged_object() {
    let json = serde_json::to_value(sample()).unwrap();

    // Not serde's default `"Permanent"` — the front discriminates on `kind`.
    assert_eq!(
        json["lifecycle"],
        serde_json::json!({ "kind": "permanent" })
    );
}

#[test]
fn an_expiring_lifecycle_serialises_flat_with_its_date() {
    let note = Note {
        lifecycle: NoteLifecycle::Expires {
            at: at("2026-08-01T00:00:00.000Z"),
        },
        ..sample()
    };

    let json = serde_json::to_value(note).unwrap();

    // Not `{"Expires":{"at":…}}`, which the TS discriminated union rejects.
    // The date is compared as an instant, not as a byte-exact string: the front
    // reads it with `new Date(iso)`, so the exact ISO spelling is not a contract.
    assert_eq!(json["lifecycle"]["kind"], "expires");
    assert_eq!(
        iso8601::parse(json["lifecycle"]["at"].as_str().unwrap()).unwrap(),
        at("2026-08-01T00:00:00.000Z")
    );
}

#[test]
fn a_patch_omitting_a_field_deserialises_to_none() {
    // The front omits what it does not touch; absent must mean "leave alone".
    let patch: NotePatch = serde_json::from_value(serde_json::json!({
        "title": "Nouveau titre"
    }))
    .unwrap();

    assert_eq!(patch.title.as_deref(), Some("Nouveau titre"));
    assert!(patch.content.is_none());
    assert!(patch.tags.is_none());
    assert!(patch.lifecycle.is_none());
}

#[test]
fn a_draft_is_read_from_the_camel_case_payload_the_front_sends() {
    let draft: NoteDraft = serde_json::from_value(serde_json::json!({
        "spaceId": "s-1",
        "title": "",
        "language": "sql",
        "content": "SELECT 1",
        "source": "",
        "tags": ["db"],
        "pinned": true,
        "lifecycle": { "kind": "expires", "at": "2026-08-01T00:00:00.000Z" }
    }))
    .unwrap();

    assert_eq!(draft.space_id, "s-1");
    assert!(draft.pinned);
    assert!(matches!(draft.lifecycle, NoteLifecycle::Expires { .. }));
}

#[test]
fn a_decorated_note_serialises_flat_with_its_footer() {
    let json = serde_json::to_value(displayed(sample())).unwrap();

    // One object: the note's own fields sit alongside the display ones.
    assert_eq!(json["id"], "n-1");
    assert_eq!(json["spaceId"], "s-1");
    assert_eq!(json["expiringSoon"], false);
    assert_eq!(json["footer"]["kind"], "age");
    assert_eq!(
        iso8601::parse(json["footer"]["at"].as_str().unwrap()).unwrap(),
        at(NOW)
    );
    assert!(json.get("note").is_none());
}

#[test]
fn a_source_footer_serialises_with_the_kind_the_front_discriminates_on() {
    let note = Note {
        pinned: true,
        source: "API Gateway / Auth".to_string(),
        ..sample()
    };

    let json = serde_json::to_value(displayed(note)).unwrap();

    assert_eq!(
        json["footer"],
        serde_json::json!({ "kind": "source", "value": "API Gateway" })
    );
}

// --- Vue -------------------------------------------------------------------

#[test]
fn a_view_serialises_with_camel_case_keys() {
    let view = NotesView {
        sections: vec![NoteSection {
            key: NoteSectionKey::Week,
            notes: vec![displayed(sample())],
            has_expiring_notes: false,
            show_create_ghost: true,
        }],
        available_tags: vec!["auth".to_string()],
        available_languages: vec![Language::Json],
        is_filtering: false,
        matched: 1,
    };

    let json = serde_json::to_value(view).unwrap();

    assert!(json.get("availableTags").is_some());
    assert!(json.get("availableLanguages").is_some());
    assert!(json.get("isFiltering").is_some());
    assert!(json.get("available_tags").is_none());
    assert!(json.get("available_languages").is_none());
    assert!(json["sections"][0].get("hasExpiringNotes").is_some());
    assert!(json["sections"][0].get("showCreateGhost").is_some());
}

#[test]
fn a_section_key_serialises_as_the_translation_key_the_front_expects() {
    let section = NoteSection {
        key: NoteSectionKey::Older,
        notes: Vec::new(),
        has_expiring_notes: false,
        show_create_ghost: false,
    };

    let json = serde_json::to_value(section).unwrap();

    // The front builds `sections.older` from this; serde's default would
    // emit "Older" and the lookup would miss.
    assert_eq!(json["key"], "older");
}

#[test]
fn a_query_is_read_from_the_camel_case_payload_the_front_sends() {
    let query: NotesQuery = serde_json::from_value(serde_json::json!({
        "spaceId": "s-1",
        "search": "deploy",
        "filter": "untriaged",
        "tags": ["urgent"],
        "languages": ["json", "yml"],
        "now": NOW,
        "tzOffsetMinutes": -120,
        "pinnedFirst": true
    }))
    .unwrap();

    assert_eq!(query.space_id.as_deref(), Some("s-1"));
    assert_eq!(query.filter, NoteFilter::Untriaged);
    assert_eq!(query.languages, [Language::Json, Language::Yml]);
    assert_eq!(query.tz_offset_minutes, -120);
    assert!(query.pinned_first);
}

#[test]
fn a_null_space_is_read_as_every_space() {
    // The front sends null, not an omitted key, when the user picks
    // "all spaces" — that is a choice, not a missing value.
    let query: NotesQuery = serde_json::from_value(serde_json::json!({
        "spaceId": null,
        "search": "",
        "filter": "all",
        "tags": [],
        "languages": [],
        "now": NOW,
        "tzOffsetMinutes": 0,
        "pinnedFirst": false
    }))
    .unwrap();

    assert!(query.space_id.is_none());
}

// --- Espace ----------------------------------------------------------------

/// `rename_all` has no effect while every field is one word: this test fails the
/// day a `created_at` is added without the attribute, instead of letting the front
/// end read `undefined`.
#[test]
fn a_space_serialises_with_the_keys_the_front_reads() {
    let json = serde_json::to_value(Space {
        id: "s-1".to_string(),
        name: "Perso".to_string(),
    })
    .unwrap();

    assert_eq!(json, serde_json::json!({ "id": "s-1", "name": "Perso" }));
}

#[test]
fn a_space_draft_is_read_from_the_payload_the_front_sends() {
    let draft: SpaceDraft =
        serde_json::from_value(serde_json::json!({ "name": "Boulot" })).unwrap();

    assert_eq!(draft.name, "Boulot");
}

// --- Erreur ----------------------------------------------------------------

#[test]
fn a_code_serialises_in_camel_case() {
    let json = serde_json::to_value(AppError::from(StorageError::NoteNotFound(
        "n-1".to_string(),
    )))
    .unwrap();

    // The front discriminates on this exact spelling; serde's default would
    // emit "NoteNotFound" and every branch would silently fall through.
    assert_eq!(json["code"], "noteNotFound");
}

#[test]
fn a_duplicate_space_name_carries_the_name_as_a_parameter() {
    let json = serde_json::to_value(AppError::from(StorageError::DuplicateSpaceName(
        "Perso".to_string(),
    )))
    .unwrap();

    // Reading the name back out of `detail` would mean parsing a French sentence.
    assert_eq!(json["code"], "duplicateSpaceName");
    assert_eq!(json["params"]["name"], "Perso");
}

#[test]
fn every_error_carries_a_non_empty_detail() {
    let errors = [
        StorageError::NoteNotFound("n-1".to_string()),
        StorageError::SpaceNotFound("s-1".to_string()),
        StorageError::DuplicateSpaceName("Perso".to_string()),
        StorageError::SchemaTooRecent("2099-01-01-000000".to_string()),
        StorageError::Migration("base verrouillée".to_string()),
    ];

    for error in errors {
        assert!(!AppError::from(error).detail.is_empty());
    }
}

#[test]
fn a_refused_value_names_the_field_at_fault() {
    let json = serde_json::to_value(AppError::from(ValidationError::new(
        "language",
        "« rust » n'est pas un langage reconnu",
    )))
    .unwrap();

    // Without it the banner would say "a value was rejected" and leave the user
    // guessing which one.
    assert_eq!(json["code"], "invalidInput");
    assert_eq!(json["params"]["field"], "language");
}

#[test]
fn a_schema_too_recent_degrades_to_storage_rather_than_leaking_a_dead_code() {
    // It cannot cross the bridge (it aborts startup), so the front has no
    // branch for it — `storage` is the honest code, and the detail carries
    // the offending migration in plain text.
    let error = AppError::from(StorageError::SchemaTooRecent(
        "2099-01-01-000000".to_string(),
    ));

    assert!(matches!(error.code, ErrorCode::Storage));
    assert!(error.detail.contains("2099-01-01-000000"));
}

#[test]
fn params_are_absent_rather_than_null_when_there_is_nothing_to_interpolate() {
    let json = serde_json::to_value(AppError::storage_unavailable()).unwrap();

    assert_eq!(json["code"], "storageUnavailable");
    assert_eq!(json["params"], serde_json::json!({}));
}

#[test]
fn an_unreadable_reference_instant_is_refused_at_the_bridge() {
    // It used to be `view::build`’s, back when `now` was a string. The type carries
    // it now: the refusal happens at deserialisation, before any section is cut on
    // an invented instant.
    let refused = serde_json::from_value::<NotesQuery>(serde_json::json!({
        "spaceId": null,
        "search": "",
        "filter": "all",
        "tags": [],
        "languages": [],
        "now": "hier",
        "tzOffsetMinutes": 0
    }));

    assert!(refused.is_err());
}

#[test]
fn an_unknown_language_is_refused_at_the_bridge() {
    // The front end can no longer send it — the bindings make it a union — but a
    // direct call to the bridge can. The closed list refuses it here.
    let refused = serde_json::from_value::<NoteDraft>(serde_json::json!({
        "spaceId": "s-1",
        "title": "",
        "language": "rust",
        "content": "",
        "source": "",
        "tags": [],
        "pinned": false,
        "lifecycle": { "kind": "permanent" }
    }));

    assert!(refused.is_err());
}

#[test]
fn an_instant_crosses_as_a_string_the_front_can_read_as_a_date() {
    // JSON has no date type: the front end does `new Date(iso)` at the boundary.
    // The exact format does not bind it — the **column** is what demands its
    // milliseconds, because the canvas sorts on it (see `db::iso8601`).
    let json = serde_json::to_value(sample()).unwrap();

    let updated_at = json["updatedAt"].as_str().unwrap();
    assert!(iso8601::parse(updated_at).is_ok());
}

// --- Trash, attachments, transfer ---------------------------------------------

#[test]
fn a_trashed_note_is_a_note_with_two_dates_more() {
    // `flatten`: the trash panel reads an ordinary note, not a nested object it
    // would have to unwrap.
    let json = serde_json::to_value(trash::trashed(sample(), at(NOW))).unwrap();

    assert_eq!(json["id"], "n-1");
    // Both dates cross as strings, like the others: the column is what demands a
    // precise format, not the bridge.
    assert!(iso8601::parse(json["deletedAt"].as_str().unwrap()).is_ok());
    assert!(iso8601::parse(json["purgeAt"].as_str().unwrap()).is_ok());
}

#[test]
fn a_decorated_note_announces_its_fields_and_its_attachments() {
    let mut note = sample();
    note.content = "psql -h {{host}} -p {{port=5432}}".to_string();
    note.placeholder_values = BTreeMap::from([("host".to_string(), "db.internal".to_string())]);

    let json = serde_json::to_value(displayed(note)).unwrap();

    assert_eq!(json["placeholders"][0]["name"], "host");
    assert_eq!(json["placeholders"][1]["defaultValue"], "5432");
    // The editor's panel reads the value **on the field**: without it a note whose
    // values are stored would reopen empty.
    assert_eq!(json["placeholders"][0]["value"], "db.internal");
    assert_eq!(json["placeholders"][1]["value"], "");
    // Filled in by whoever holds the connection; zero by default.
    assert_eq!(json["attachmentCount"], 0);
}

#[test]
fn an_attachment_serialises_with_camel_case_keys() {
    let json = serde_json::to_value(Attachment {
        id: "a-1".to_string(),
        note_id: "n-1".to_string(),
        file_name: "capture.png".to_string(),
        mime_type: "image/png".to_string(),
        byte_size: 42,
        created_at: at(NOW),
    })
    .unwrap();

    assert_eq!(json["noteId"], "n-1");
    assert_eq!(json["fileName"], "capture.png");
    assert_eq!(json["mimeType"], "image/png");
    assert_eq!(json["byteSize"], 42);
    assert!(json.get("note_id").is_none());
}

#[test]
fn a_tag_usage_carries_its_count_under_a_camel_case_key() {
    let json = serde_json::to_value(TagUsage {
        tag: "auth".to_string(),
        note_count: 3,
    })
    .unwrap();

    assert_eq!(json["tag"], "auth");
    assert_eq!(json["noteCount"], 3);
}

#[test]
fn an_import_report_names_what_it_skipped() {
    let json = serde_json::to_value(ImportReport {
        spaces_created: 1,
        notes_imported: 2,
        notes_skipped: 3,
    })
    .unwrap();

    assert_eq!(json["spacesCreated"], 1);
    assert_eq!(json["notesImported"], 2);
    assert_eq!(json["notesSkipped"], 3);
}

#[test]
fn an_export_bundle_reads_back_the_notes_it_wrote() {
    // The file is the contract between two versions of DevBox, not only between
    // the Rust side and the front end.
    let bundle = Bundle {
        version: transfer::model::FORMAT_VERSION,
        exported_at: at(NOW),
        spaces: vec![Space {
            id: "s-1".to_string(),
            name: "Perso".to_string(),
        }],
        notes: vec![sample()],
    };
    let json = serde_json::to_string(&bundle).unwrap();

    assert!(json.contains("\"exportedAt\""));
    let read = transfer::model::read_bundle(&json).unwrap();
    assert_eq!(read.notes[0].id, "n-1");
}

#[test]
fn a_note_announces_its_kind_and_its_items() {
    let note = Note {
        kind: NoteKind::Checklist,
        items: vec![ChecklistItem {
            text: "Relire".to_string(),
            done: true,
        }],
        ..sample()
    };

    let json = serde_json::to_value(note).unwrap();

    // A unit enum: a bare string, like `language` — and not a tagged object, unlike
    // `lifecycle`.
    assert_eq!(json["kind"], serde_json::json!("checklist"));
    assert_eq!(json["items"][0]["text"], serde_json::json!("Relire"));
    assert_eq!(json["items"][0]["done"], serde_json::json!(true));
}

#[test]
fn an_ordinary_note_still_crosses_as_a_snippet() {
    let json = serde_json::to_value(sample()).unwrap();

    assert_eq!(json["kind"], serde_json::json!("snippet"));
    assert_eq!(json["items"], serde_json::json!([]));
}

#[test]
fn an_export_written_before_todo_lists_existed_still_reads() {
    // `Bundle` deserialises `Note` itself: without `#[serde(default)]` on `kind`
    // and `items`, every file already exported would become unreadable.
    let json = serde_json::json!({
        "version": transfer::model::FORMAT_VERSION,
        "exportedAt": NOW,
        "spaces": [],
        "notes": [{
            "id": "n-1",
            "spaceId": "s-1",
            "title": "Titre",
            "language": "txt",
            "content": "Contenu",
            "source": "",
            "tags": [],
            "pinned": false,
            "createdAt": NOW,
            "updatedAt": NOW,
            "lifecycle": { "kind": "permanent" }
        }],
    })
    .to_string();

    let read = transfer::model::read_bundle(&json).unwrap();

    assert_eq!(read.notes[0].kind, NoteKind::Snippet);
    assert!(read.notes[0].items.is_empty());
    // Same guarantee, same reason: `placeholderValues` arrived after those files.
    assert!(read.notes[0].placeholder_values.is_empty());
}

#[test]
fn the_values_of_the_fields_cross_as_a_named_map() {
    let mut note = sample();
    note.placeholder_values = BTreeMap::from([("host".to_string(), "db.internal".to_string())]);

    let json = serde_json::to_value(note).unwrap();

    // An array of pairs would make the front end rebuild it to look anything up
    // un nom ; l'export, lui, relit exactement cette forme.
    assert_eq!(
        json["placeholderValues"],
        serde_json::json!({ "host": "db.internal" })
    );
}

#[test]
fn a_patch_omitting_the_items_deserialises_to_none() {
    let patch: NotePatch = serde_json::from_value(serde_json::json!({ "title": "T" })).unwrap();

    // A `Some(vec![])` would empty the list instead of leaving it alone.
    assert!(patch.items.is_none());
    assert!(patch.kind.is_none());
}

#[test]
fn every_error_code_crosses_as_a_camel_case_string() {
    // The front end's `CODE_KEYS` table is keyed on it: a `snake_case` here would
    // find no translation key there.
    for (error, expected) in [
        (
            StorageError::AttachmentNotFound("a-1".to_string()),
            "attachmentNotFound",
        ),
        (StorageError::File("disk".to_string()), "fileAccess"),
        (
            StorageError::ImportFormat("nope".to_string()),
            "importFormat",
        ),
    ] {
        let json = serde_json::to_value(AppError::from(error)).unwrap();

        assert_eq!(json["code"], expected);
    }
}
