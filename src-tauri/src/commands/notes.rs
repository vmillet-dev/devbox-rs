//! Commandes « Prise de notes ».
//!
//! Trois garanties dont le front dépend : [`create_note`] et [`update_note`]
//! renvoient la note **telle que persistée** (c'est elle que l'éditeur adopte) ;
//! un identifiant inconnu renvoie `Err`, jamais un `Ok` silencieux ; et dans un
//! `NotePatch` un champ absent signifie « ne pas toucher ».

use tauri::State;

use super::error::AppError;
use super::lock;
use crate::domain::note::{self, DisplayNote, NoteDraft, NotePatch};
use crate::domain::view::{self, NotesQuery, NotesView};
use crate::storage::{self, Db};

/// Notes filtrées **et** regroupées, prêtes à afficher. Aucune commande ne rend
/// la liste brute : elle inviterait à refiltrer côté front.
#[tauri::command]
pub fn query_notes(query: NotesQuery, db: State<'_, Db>) -> Result<NotesView, AppError> {
    let connection = lock(&db)?;
    let (notes, facets) = storage::notes::fetch(&connection, &query)?;

    Ok(view::build(notes, facets, &query)?)
}

#[tauri::command]
pub fn create_note(draft: NoteDraft, db: State<'_, Db>) -> Result<DisplayNote, AppError> {
    // Validé avant de verrouiller : inutile de prendre le verrou pour un refus.
    draft.validate()?;

    let mut connection = lock(&db)?;
    let note = storage::notes::create(&mut connection, &draft, &storage::now_iso())?;

    Ok(note::decorate_now(note))
}

#[tauri::command]
pub fn update_note(
    id: String,
    patch: NotePatch,
    db: State<'_, Db>,
) -> Result<DisplayNote, AppError> {
    patch.validate()?;

    let mut connection = lock(&db)?;
    let note = storage::notes::update(&mut connection, &id, &patch, &storage::now_iso())?;

    Ok(note::decorate_now(note))
}

#[tauri::command]
pub fn delete_note(id: String, db: State<'_, Db>) -> Result<(), AppError> {
    let connection = lock(&db)?;

    Ok(storage::notes::delete(&connection, &id)?)
}
