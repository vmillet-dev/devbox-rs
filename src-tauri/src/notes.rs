//! Commandes « Prise de notes ».
//!
//! Trois garanties dont le front dépend : [`create_note`] et [`update_note`]
//! renvoient la note **telle que persistée** (c'est elle que l'éditeur adopte) ;
//! un identifiant inconnu renvoie `Err`, jamais un `Ok` silencieux ; et dans un
//! `NotePatch` un champ absent signifie « ne pas toucher ».
//!
//! Plus rien à valider ici : le langage est un enum, donc une valeur inconnue ne
//! passe plus la désérialisation — et ne compile plus côté front.

// Une commande reçoit ses arguments désérialisés depuis la charge utile IPC :
// ils arrivent possédés, qu'elle les consomme ou non.
#![allow(clippy::needless_pass_by_value)]

pub mod language;
pub mod model;
pub mod store;
pub mod view;

/// Note de référence partagée par les tests de la feature : un champ ajouté à
/// [`model::Note`] se déclare ici plutôt que dans chaque module qui en construit une.
#[cfg(test)]
pub(crate) mod fixtures {
    use chrono::{DateTime, Utc};

    use super::language::Language;
    use super::model::{Note, NoteLifecycle};
    use crate::db::iso8601;

    pub(crate) const NOW: &str = "2026-07-25T09:00:00.000Z";

    pub(crate) fn at(iso: &str) -> DateTime<Utc> {
        iso8601::parse(iso).expect("les tests écrivent des instants valides")
    }

    pub(crate) fn note() -> Note {
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
        }
    }
}

use chrono::Utc;
use tauri::State;

use crate::db::{Db, lock};
use crate::error::AppError;
use model::{DisplayNote, NoteDraft, NotePatch};
use view::{NotesQuery, NotesView};

/// Notes filtrées **et** regroupées, prêtes à afficher. Aucune commande ne rend
/// la liste brute : elle inviterait à refiltrer côté front.
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
