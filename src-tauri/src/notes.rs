//! "Notes taking" commands.
//!
//! Three guarantees the front-end depends on: [`create_note`] and [`update_note`]
//! return the note **as persisted** (which the editor then adopts);
//! an unknown identifier returns an `Err`, never a silent `Ok`; and in a
//! `NotePatch`, an absent field means "do not touch".
//!
//! Nothing left to validate here: the language is an enum, so an unknown value
//! no longer passes deserialization — and no longer compiles on the front-end side.

// A command receives its arguments deserialized from the IPC payload:
// they arrive owned, whether it consumes them or not.
#![allow(clippy::needless_pass_by_value)]

pub mod language;
pub mod model;
pub mod store;
pub mod view;

/// Reference note shared by the feature tests: a field added to
/// [`model::Note`] is declared here rather than in every module that builds one.
#[cfg(test)]
pub(crate) mod fixtures {
    use chrono::{DateTime, Utc};

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
        }
    }
}

use chrono::Utc;
use tauri::State;

use crate::db::{Db, lock};
use crate::error::AppError;
use model::{DisplayNote, NoteDraft, NotePatch};
use view::{NotesQuery, NotesView};

/// Filtered **and** grouped notes, ready to display. No command returns
/// the raw list: it would invite re-filtering on the front-end side.
#[tauri::command]
#[specta::specta]
pub fn query_notes(query: NotesQuery, db: State<'_, Db>) -> Result<NotesView, AppError> {
    let mut connection = lock(&db)?;
    let (notes, facets) = store::fetch(&mut connection, &query)?;

    Ok(view::build(notes, facets, &query))
}

#[tauri::command]
#[specta::specta]
pub fn create_note(draft: NoteDraft, db: State<'_, Db>) -> Result<DisplayNote, AppError> {
    let mut connection = lock(&db)?;
    let note = store::create(&mut connection, draft, Utc::now())?;

    Ok(model::decorate_now(note))
}

#[tauri::command]
#[specta::specta]
pub fn update_note(
    id: String,
    patch: NotePatch,
    db: State<'_, Db>,
) -> Result<DisplayNote, AppError> {
    let mut connection = lock(&db)?;
    let note = store::update(&mut connection, &id, &patch, Utc::now())?;

    Ok(model::decorate_now(note))
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(id: String, db: State<'_, Db>) -> Result<(), AppError> {
    let mut connection = lock(&db)?;

    Ok(store::delete(&mut connection, &id)?)
}
