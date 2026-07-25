//! Module « Espaces » : les classeurs dans lesquels les notes sont rangées.
//!
//! Même statut que `notes` : de simples adaptateurs au-dessus de
//! `storage::spaces`.
//!
//! Un espace est intentionnellement minimal (un identifiant, un nom) : c'est le
//! `space_id` de chaque note qui porte la relation. Le front n'a **aucune**
//! entrée « Tous les espaces » côté données — c'est un mode d'affichage, pas un
//! espace : n'en créez donc pas un ici, des notes finiraient rangées dedans.
//!
//! # Ce qui reste à décider
//!
//! - **Un espace par défaut au premier lancement.** `list_spaces` renvoie
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

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::storage::{self, Db};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Space {
    pub id: String,
    /// Nom affiché dans le sélecteur. Le front refuse déjà les homonymes à la
    /// création ; le stockage impose la même contrainte, insensible à la casse.
    pub name: String,
}

/// Création : pas d'identifiant, il est attribué ici.
#[derive(Debug, Clone, Deserialize)]
pub struct SpaceDraft {
    pub name: String,
}

fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
    db.lock()
        .map_err(|_| "Stockage indisponible : une opération précédente a échoué".to_string())
}

#[tauri::command]
pub fn list_spaces(db: State<'_, Db>) -> Result<Vec<Space>, String> {
    let connection = lock(&db)?;
    storage::spaces::list(&connection).map_err(|error| error.to_string())
}

/// Le front sélectionne aussitôt l'espace à partir de la valeur renvoyée.
#[tauri::command]
pub fn create_space(draft: SpaceDraft, db: State<'_, Db>) -> Result<Space, String> {
    let connection = lock(&db)?;
    storage::spaces::create(&connection, &draft).map_err(|error| error.to_string())
}
