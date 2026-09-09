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

pub mod checklist;
pub mod language;
pub mod model;
pub mod placeholder;
pub mod store;
pub mod trash;
pub mod view;

/// Reference note shared by the feature tests: a field added to
/// [`model::Note`] is declared here rather than in every module that builds one.
#[cfg(test)]
pub(crate) mod fixtures {
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
        }
    }
}

use std::collections::BTreeMap;

use chrono::Utc;
use diesel::SqliteConnection;
use tauri::{AppHandle, State};

use crate::attachments;
use crate::db::{Db, lock};
use crate::error::{AppError, StorageError};
use model::{DisplayNote, NoteDraft, NotePatch, TagUsage};
use trash::TrashedNote;
use view::{NotesQuery, NotesView};

/// Filtered **and** grouped notes, ready to display. No command returns
/// the raw list: it would invite re-filtering on the front-end side.
#[tauri::command]
#[specta::specta]
pub fn query_notes(query: NotesQuery, db: State<'_, Db>) -> Result<NotesView, AppError> {
    let mut connection = lock(&db)?;
    let (notes, facets) = store::fetch(&mut connection, &query)?;
    let counts = attachments::store::counts(&mut connection)?;

    let mut view = view::build(notes, facets, &query);
    view::apply_attachment_counts(&mut view, &counts);

    Ok(view)
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
    let decorated = model::decorate_now(note);

    Ok(with_attachment_count(&mut connection, decorated)?)
}

/// **Met à la corbeille** : la note revient par [`restore_notes`] pendant
/// [`trash::RETENTION`]. Rien ne supprime définitivement sans passer par là.
#[tauri::command]
#[specta::specta]
pub fn delete_note(id: String, db: State<'_, Db>) -> Result<(), AppError> {
    let mut connection = lock(&db)?;

    Ok(store::delete(&mut connection, &id, Utc::now())?)
}

/// Renvoie le nombre de notes réellement mises à la corbeille : c'est ce que
/// l'annulation propose de reprendre.
#[tauri::command]
#[specta::specta]
pub fn delete_notes(ids: Vec<String>, db: State<'_, Db>) -> Result<u32, AppError> {
    let mut connection = lock(&db)?;

    Ok(count(store::delete_many(
        &mut connection,
        &ids,
        Utc::now(),
    )?))
}

#[tauri::command]
#[specta::specta]
pub fn restore_notes(ids: Vec<String>, db: State<'_, Db>) -> Result<u32, AppError> {
    let mut connection = lock(&db)?;

    Ok(count(store::restore_many(&mut connection, &ids)?))
}

/// Purge d'abord ce que la rétention a rattrapé : la corbeille ne doit jamais
/// montrer une note qu'un redémarrage effacerait.
#[tauri::command]
#[specta::specta]
pub fn list_trash(app: AppHandle, db: State<'_, Db>) -> Result<Vec<TrashedNote>, AppError> {
    purge_expired(&app, &db)?;

    let mut connection = lock(&db)?;

    Ok(store::list_trashed(&mut connection)?
        .into_iter()
        .map(|(note, deleted_at)| trash::trashed(note, deleted_at))
        .collect())
}

#[tauri::command]
#[specta::specta]
pub fn purge_notes(ids: Vec<String>, app: AppHandle, db: State<'_, Db>) -> Result<u32, AppError> {
    Ok(count(purge(&app, &db, ids)?))
}

#[tauri::command]
#[specta::specta]
pub fn empty_trash(app: AppHandle, db: State<'_, Db>) -> Result<u32, AppError> {
    let ids = {
        let mut connection = lock(&db)?;
        store::trashed_ids(&mut connection)?
    };

    Ok(count(purge(&app, &db, ids)?))
}

#[tauri::command]
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

/// Ajoute des tags à toute une sélection. Normalisés ici comme partout ailleurs,
/// sinon un `#urgent` saisi dans la barre d'actions ne rejoindrait pas le
/// `urgent` déjà en base.
#[tauri::command]
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

#[tauri::command]
#[specta::specta]
pub fn list_tags(db: State<'_, Db>) -> Result<Vec<TagUsage>, AppError> {
    let mut connection = lock(&db)?;

    Ok(store::tag_usage(&mut connection)?
        .into_iter()
        .map(|(tag, notes)| TagUsage {
            tag,
            note_count: u32::try_from(notes).unwrap_or(u32::MAX),
        })
        .collect())
}

/// Un renommage vers un tag déjà existant **est** une fusion : la base ne peut
/// pas porter deux fois le même tag sur une note.
#[tauri::command]
#[specta::specta]
pub fn rename_tag(tag: String, into: String, db: State<'_, Db>) -> Result<u32, AppError> {
    let target = model::validated_tag(&into)?;

    let mut connection = lock(&db)?;

    Ok(count(store::retag(&mut connection, &[tag], &target)?))
}

#[tauri::command]
#[specta::specta]
pub fn merge_tags(tags: Vec<String>, into: String, db: State<'_, Db>) -> Result<u32, AppError> {
    let target = model::validated_tag(&into)?;

    let mut connection = lock(&db)?;

    Ok(count(store::retag(&mut connection, &tags, &target)?))
}

/// Retire l'étiquette du corpus ; les notes, elles, restent.
#[tauri::command]
#[specta::specta]
pub fn delete_tag(tag: String, db: State<'_, Db>) -> Result<u32, AppError> {
    let mut connection = lock(&db)?;

    Ok(count(store::drop_tag(&mut connection, &tag)?))
}

/// Remplit les `{{champs}}` d'un contenu. Pas de base ici : la palette remplit
/// aussi bien un brouillon non enregistré que la note qu'elle vient d'ouvrir.
#[tauri::command]
#[specta::specta]
pub fn fill_placeholders(content: String, values: BTreeMap<String, String>) -> String {
    placeholder::fill(&content, &values)
}

/// `usize` ne traverse pas le pont (Specta refuse ce que JSON ne rend pas sans
/// perte) ; ces compteurs plafonnent bien avant `u32`.
fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Supprime pour de bon, **fichiers joints compris**. Les noms sont relevés
/// avant le `DELETE` : après, la cascade a effacé les fiches qui les portaient.
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

/// Nettoyage au démarrage : la rétention s'applique même si personne n'ouvre la
/// corbeille. Un échec est journalisé, jamais fatal — l'application doit
/// démarrer.
pub fn sweep_trash_at_startup(app: &AppHandle, db: &Db) {
    if let Err(error) = purge_expired(app, db) {
        log::warn!("Expired trash not purged: {}", error.detail);
    }
}

/// `decorate` ne lit pas la base : le compteur de pièces jointes est posé après
/// coup, par ce qui tient la connexion.
fn with_attachment_count(
    connection: &mut SqliteConnection,
    mut note: DisplayNote,
) -> Result<DisplayNote, StorageError> {
    note.attachment_count = count(attachments::store::list(connection, &note.id)?.len());

    Ok(note)
}
