//! Commandes « Prise de notes ».
//!
//! De simples **adaptateurs** : elles verrouillent la connexion partagée,
//! enchaînent persistance puis règles métier, et convertissent l'erreur en
//! [`AppError`] pour le pont Tauri. Aucune décision n'est prise ici — le modèle
//! et les règles sont dans `crate::domain`, le SQL dans `crate::storage`.
//!
//! # Le back décide de ce qui est affiché
//!
//! [`query_notes`] ne renvoie pas une liste mais une **vue** : notes filtrées,
//! déjà réparties en sections, accompagnées des tags proposables et du drapeau
//! « une recherche est en cours ». Le front ne refiltre, ne regroupe et ne trie
//! rien — il affiche ce qu'il reçoit.
//!
//! Règles que le front tient pour acquises, et que cette couche honore :
//! - [`create_note`] et [`update_note`] **renvoient la note telle que
//!   persistée** (identifiant définitif, `updated_at` rafraîchi, tags
//!   normalisés) : c'est cette valeur que l'éditeur adopte, et elle fait autorité.
//! - [`update_note`] / [`delete_note`] sur un identifiant inconnu renvoient
//!   `Err`, jamais un `Ok` silencieux : sans ça le front croirait avoir enregistré.
//! - Dans un `NotePatch`, un champ **absent** signifie « ne pas toucher ». Le
//!   front n'envoie jamais `null` pour cela (voir `toNotePatchDto`), donc un
//!   `Option::None` n'écrase jamais la valeur stockée.

use tauri::State;

use super::error::AppError;
use super::lock;
use crate::domain::display::{self, DisplayNote};
use crate::domain::note::{NoteDraft, NotePatch};
use crate::domain::query::{NotesQuery, NotesView};
use crate::domain::view;
use crate::storage::{self, Db};

/// Notes filtrées **et** regroupées, prêtes à afficher. Il n'existe pas de
/// commande renvoyant la liste brute : elle inviterait à refiltrer côté front.
#[tauri::command]
pub fn query_notes(query: NotesQuery, db: State<'_, Db>) -> Result<NotesView, AppError> {
    let connection = lock(&db)?;
    let (notes, available_tags) = storage::notes::fetch(&connection, &query)?;

    Ok(view::build(notes, available_tags, &query)?)
}

#[tauri::command]
pub fn create_note(draft: NoteDraft, db: State<'_, Db>) -> Result<DisplayNote, AppError> {
    // Validé avant d'ouvrir la connexion : rien ne sert de verrouiller pour
    // écrire une donnée qu'on refuse.
    draft.validate()?;

    let mut connection = lock(&db)?;
    let note = storage::notes::create(&mut connection, &draft, &storage::now_iso())?;

    Ok(display::decorate_now(note))
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

    Ok(display::decorate_now(note))
}

#[tauri::command]
pub fn delete_note(id: String, db: State<'_, Db>) -> Result<(), AppError> {
    let connection = lock(&db)?;

    Ok(storage::notes::delete(&connection, &id)?)
}
