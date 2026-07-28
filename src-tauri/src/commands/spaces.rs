//! Commandes « Espaces » : les classeurs dans lesquels les notes sont rangées.
//!
//! Même statut que `notes` : de simples adaptateurs au-dessus de
//! `storage::spaces`. Le modèle est dans `crate::domain::space`.
//!
//! # Suppression : les notes sont déplacées, jamais perdues
//!
//! Le schéma porte un `ON DELETE CASCADE` sur `notes.space_id`, donc un
//! `DELETE` nu emporterait les notes de l'espace. [`delete_space`] exige pour
//! cette raison un espace **refuge** et y transfère les notes dans la même
//! transaction, avant la suppression. Il n'existe volontairement aucune variante
//! sans refuge : la seule façon de perdre une note reste `delete_note`, où
//! l'utilisateur voit ce qu'il supprime.
//!
//! # Ce qui reste à décider
//!
//! - **Un espace par défaut au premier lancement.** [`list_spaces`] renvoie
//!   aujourd'hui une liste vide au premier démarrage : l'application refuse
//!   alors de créer une note (il n'y a nulle part où la ranger) et affiche
//!   « Créez d'abord un espace ». Créer un espace initial (« Perso », par ex.)
//!   éviterait cet écran ; c'est un choix produit, pas une contrainte technique.

use tauri::State;

use super::error::AppError;
use super::lock;
use crate::domain::space::{self, Space, SpaceDraft};
use crate::storage::{self, Db};

#[tauri::command]
pub fn list_spaces(db: State<'_, Db>) -> Result<Vec<Space>, AppError> {
    let connection = lock(&db)?;

    Ok(storage::spaces::list(&connection)?)
}

/// Le front sélectionne aussitôt l'espace à partir de la valeur renvoyée.
#[tauri::command]
pub fn create_space(draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, AppError> {
    // La persistance reçoit un nom déjà détouré et non vide : elle n'a plus
    // qu'à trancher l'unicité, qui est la seule chose qu'elle seule sait voir.
    let name = draft.validated_name()?;

    let connection = lock(&db)?;

    Ok(storage::spaces::create(&connection, &name)?)
}

/// Renomme un espace. Le brouillon est le même qu'à la création, donc la même
/// validation s'applique : un nom détouré et non vide.
#[tauri::command]
pub fn rename_space(id: String, draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, AppError> {
    let name = draft.validated_name()?;

    let connection = lock(&db)?;

    Ok(storage::spaces::rename(&connection, &id, &name)?)
}

/// Supprime un espace après avoir transféré ses notes vers `target_space_id`.
///
/// ⚠️ Tauri v2 renomme les arguments en camelCase : le front envoie
/// `targetSpaceId`, pas `target_space_id` (cf. `IpcContract`).
#[tauri::command]
pub fn delete_space(
    id: String,
    target_space_id: String,
    db: State<'_, Db>,
) -> Result<(), AppError> {
    // Refusé avant de verrouiller : un espace qui serait son propre refuge
    // verrait ses notes emportées par la cascade juste après le transfert.
    space::validate_move_target(&id, &target_space_id)?;

    let mut connection = lock(&db)?;

    Ok(storage::spaces::delete(
        &mut connection,
        &id,
        &target_space_id,
    )?)
}
