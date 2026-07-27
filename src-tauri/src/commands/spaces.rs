//! Commandes « Espaces » : les classeurs dans lesquels les notes sont rangées.
//!
//! Même statut que `notes` : de simples adaptateurs au-dessus de
//! `storage::spaces`. Le modèle est dans `crate::domain::space`.
//!
//! # Ce qui reste à décider
//!
//! - **Un espace par défaut au premier lancement.** [`list_spaces`] renvoie
//!   aujourd'hui une liste vide au premier démarrage : l'application refuse
//!   alors de créer une note (il n'y a nulle part où la ranger) et affiche
//!   « Créez d'abord un espace ». Créer un espace initial (« Perso », par ex.)
//!   éviterait cet écran ; c'est un choix produit, pas une contrainte technique.
//! - **La suppression et le renommage.** Aucune commande n'existe encore. Le
//!   schéma tranche déjà le sort des notes en cas de suppression
//!   (`ON DELETE CASCADE` : elles partent avec l'espace) ; si le produit préfère
//!   les déplacer vers un espace par défaut, il faudra le faire *avant* le
//!   `DELETE`. Le champ `spaceId` d'une note est déjà modifiable via
//!   `NotePatch`, donc le déplacement ne demande qu'une commande et une entrée
//!   de menu.

use tauri::State;

use super::error::AppError;
use super::lock;
use crate::domain::space::{Space, SpaceDraft};
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
