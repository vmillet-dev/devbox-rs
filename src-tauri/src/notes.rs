// Commands receive their arguments owned, deserialized from the IPC payload.
#![allow(clippy::needless_pass_by_value)]

pub mod checklist;
pub mod language;
pub mod model;
pub mod placeholder;
pub mod store;
pub mod trash;
pub mod view;

/// Reference note for the feature tests: a field added to [`model::Note`] is
/// declared here rather than in every module that builds one.
#[cfg(test)]
pub(crate) mod fixtures {
    use std::collections::BTreeMap;

    use chrono::{DateTime, Utc};

    use super::checklist::NoteKind;
    use super::language::Language;
    use super::model::{Note, NoteLifecycle};
    use crate::db::iso8601;

    pub(crate) const NOW: &str = "2026-07-25T09:00:00.000Z";

    pub(crate) fn at(iso: &str) -> DateTime<Utc> {
        iso8601::parse(iso).expect("tests write valid instants")
    }

    pub(crate) fn note() -> Note {
        Note {
            id: "n-1".to_string(),
            space_id: "s-1".to_string(),
            title: "Title".to_string(),
            language: Language::Txt,
            content: "Content".to_string(),
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
}

use std::collections::BTreeMap;

use chrono::Utc;
use diesel::SqliteConnection;
use tauri::{AppHandle, State};

use crate::attachments;
use crate::count::saturating_u32 as count;
use crate::db::{Db, lock};
use crate::error::{AppError, StorageError};
use model::{DisplayNote, NoteDraft, NotePatch, TagUsage};
use trash::TrashedNote;
use view::{NotesQuery, NotesView};

/// No command returns the raw list: it would invite re-filtering on the front end.
#[tauri::command(async)]
#[specta::specta]
pub fn query_notes(query: NotesQuery, db: State<'_, Db>) -> Result<NotesView, AppError> {
    let mut connection = lock(&db)?;
    let (notes, facets) = store::fetch(&mut connection, &query)?;
    let counts = attachments::store::counts(&mut connection)?;

    let globals = store::global_placeholder_values(&mut connection)?;

    let mut view = view::build(notes, facets, &query);
    view::apply_attachment_counts(&mut view, &counts);
    view::apply_global_defaults(&mut view, &globals);

    Ok(view)
}

#[tauri::command(async)]
#[specta::specta]
pub fn create_note(draft: NoteDraft, db: State<'_, Db>) -> Result<DisplayNote, AppError> {
    let mut connection = lock(&db)?;
    let note = store::create(&mut connection, draft, Utc::now())?;

    Ok(display(&mut connection, note)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn update_note(
    id: String,
    patch: NotePatch,
    db: State<'_, Db>,
) -> Result<DisplayNote, AppError> {
    let mut connection = lock(&db)?;
    let note = store::update(&mut connection, &id, &patch, Utc::now())?;

    Ok(display(&mut connection, note)?)
}

/// **Moves to the trash**: the note comes back through [`restore_notes`] for
/// [`trash::RETENTION`].
#[tauri::command(async)]
#[specta::specta]
pub fn delete_note(id: String, db: State<'_, Db>) -> Result<(), AppError> {
    let mut connection = lock(&db)?;

    Ok(store::delete(&mut connection, &id, Utc::now())?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn delete_notes(ids: Vec<String>, db: State<'_, Db>) -> Result<u32, AppError> {
    let mut connection = lock(&db)?;

    Ok(count(store::delete_many(
        &mut connection,
        &ids,
        Utc::now(),
    )?))
}

#[tauri::command(async)]
#[specta::specta]
pub fn restore_notes(ids: Vec<String>, db: State<'_, Db>) -> Result<u32, AppError> {
    let mut connection = lock(&db)?;

    Ok(count(store::restore_many(&mut connection, &ids)?))
}

/// Purges what retention has caught up with **first**: the trash must never
/// show a note a restart would erase.
#[tauri::command(async)]
#[specta::specta]
pub fn list_trash(app: AppHandle, db: State<'_, Db>) -> Result<Vec<TrashedNote>, AppError> {
    purge_expired(&app, &db)?;

    let mut connection = lock(&db)?;

    Ok(store::list_trashed(&mut connection)?
        .into_iter()
        .map(|(note, deleted_at)| trash::trashed(note, deleted_at))
        .collect())
}

#[tauri::command(async)]
#[specta::specta]
pub fn purge_notes(ids: Vec<String>, app: AppHandle, db: State<'_, Db>) -> Result<u32, AppError> {
    Ok(count(purge(&app, &db, ids)?))
}

#[tauri::command(async)]
#[specta::specta]
pub fn empty_trash(app: AppHandle, db: State<'_, Db>) -> Result<u32, AppError> {
    let ids = {
        let mut connection = lock(&db)?;
        store::trashed_ids(&mut connection)?
    };

    Ok(count(purge(&app, &db, ids)?))
}

#[tauri::command(async)]
#[specta::specta]
pub fn move_notes(ids: Vec<String>, space_id: String, db: State<'_, Db>) -> Result<u32, AppError> {
    let mut connection = lock(&db)?;

    Ok(count(store::move_many(
        &mut connection,
        &ids,
        &space_id,
        Utc::now(),
    )?))
}

/// Normalised here as everywhere else, or an `#urgent` typed in the action bar
/// would not join the `urgent` already stored.
#[tauri::command(async)]
#[specta::specta]
pub fn tag_notes(ids: Vec<String>, tags: Vec<String>, db: State<'_, Db>) -> Result<u32, AppError> {
    let normalized = model::normalize_tags(&tags);

    let mut connection = lock(&db)?;

    Ok(count(store::tag_many(
        &mut connection,
        &ids,
        &normalized,
        Utc::now(),
    )?))
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_tags(db: State<'_, Db>) -> Result<Vec<TagUsage>, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::tag_usage(&mut connection)?
        .into_iter()
        .map(|(tag, notes)| TagUsage {
            tag,
            note_count: count(notes),
        })
        .collect())
}

/// Renaming onto an existing tag **is** a merge: a note cannot carry one twice.
#[tauri::command(async)]
#[specta::specta]
pub fn rename_tag(tag: String, into: String, db: State<'_, Db>) -> Result<u32, AppError> {
    let target = model::validated_tag(&into)?;

    let mut connection = lock(&db)?;

    Ok(count(store::retag(&mut connection, &[tag], &target)?))
}

#[tauri::command(async)]
#[specta::specta]
pub fn merge_tags(tags: Vec<String>, into: String, db: State<'_, Db>) -> Result<u32, AppError> {
    let target = model::validated_tag(&into)?;

    let mut connection = lock(&db)?;

    Ok(count(store::retag(&mut connection, &tags, &target)?))
}

/// A list rather than one tag at a time: the panel deletes a whole selection, and
/// one round trip per tag was one lock and one transaction per tag.
#[tauri::command(async)]
#[specta::specta]
pub fn delete_tags(tags: Vec<String>, db: State<'_, Db>) -> Result<u32, AppError> {
    let mut connection = lock(&db)?;

    Ok(count(store::drop_tags(&mut connection, &tags)?))
}

/// ⚠️ A command of its own rather than a `NotePatch` field: filling a field is not
/// editing the note, so `updated_at` stays put — the canvas sorts on it.
#[tauri::command(async)]
#[specta::specta]
pub fn set_placeholder_values(
    id: String,
    values: BTreeMap<String, String>,
    db: State<'_, Db>,
) -> Result<DisplayNote, AppError> {
    let retained = placeholder::normalize_values(values);

    let mut connection = lock(&db)?;
    let note = store::set_placeholder_values(&mut connection, &id, &retained)?;

    Ok(display(&mut connection, note)?)
}

/// No note identifier: the palette fills an unsaved draft as readily as the note
/// it just opened. The database is read only for the **global variables**.
#[tauri::command(async)]
#[specta::specta]
pub fn fill_placeholders(
    content: String,
    values: BTreeMap<String, String>,
    db: State<'_, Db>,
) -> Result<String, AppError> {
    let mut connection = lock(&db)?;
    let globals = store::global_placeholder_values(&mut connection)?;

    Ok(placeholder::fill(
        &content,
        &placeholder::resolve(&globals, &values),
    ))
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_global_placeholders(db: State<'_, Db>) -> Result<BTreeMap<String, String>, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::global_placeholder_values(&mut connection)?)
}

/// Stores the **whole** set: what is not sent is what the user removed. No note is
/// touched, not even its `updated_at`.
#[tauri::command(async)]
#[specta::specta]
pub fn set_global_placeholders(
    values: BTreeMap<String, String>,
    db: State<'_, Db>,
) -> Result<BTreeMap<String, String>, AppError> {
    let retained = placeholder::normalize_values(values);

    let mut connection = lock(&db)?;
    store::replace_global_placeholder_values(&mut connection, &retained)?;

    Ok(retained)
}

/// ⚠️ The file names are collected before the `DELETE`: afterwards the cascade has
/// taken the records that carried them.
fn purge(app: &AppHandle, db: &Db, ids: Vec<String>) -> Result<usize, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }

    let directory = attachments::directory(app)?;

    let mut connection = lock(db)?;
    let files = attachments::store::stored_names_of(&mut connection, &ids)?;
    let purged = store::purge(&mut connection, &ids)?;
    drop(connection);

    attachments::remove_files(&directory, &files);

    Ok(purged)
}

fn purge_expired(app: &AppHandle, db: &Db) -> Result<(), AppError> {
    let expired = {
        let mut connection = lock(db)?;
        store::expired_ids(&mut connection, Utc::now())?
    };

    purge(app, db, expired)?;

    Ok(())
}

/// Retention applies even if nobody opens the trash. A failure is logged, never
/// fatal — the application has to start.
pub fn sweep_trash_at_startup(app: &AppHandle, db: &Db) {
    if let Err(error) = purge_expired(app, db) {
        log::warn!("Expired trash not purged: {}", error.detail);
    }
}

/// What only the database knows: the attachment count, and the global variables
/// laid on the fields as proposed values. Both are queries of their own, which is
/// why neither lives in [`model::decorate`].
fn display(
    connection: &mut SqliteConnection,
    note: model::Note,
) -> Result<DisplayNote, StorageError> {
    let mut decorated = model::decorate_now(note);
    decorated.attachment_count = count(attachments::store::list(connection, &decorated.id)?.len());
    model::apply_global_defaults(
        &mut decorated,
        &store::global_placeholder_values(connection)?,
    );

    Ok(decorated)
}
