//! Module « Espaces » : les classeurs dans lesquels les notes sont rangées.
//!
//! Même statut que `notes` : structures et signatures figées, corps à écrire.
//! Le front appelle ces commandes via `src/app/core/data/tauri-spaces-repository.ts`.
//!
//! Un espace est intentionnellement minimal (un identifiant, un nom) : c'est le
//! `space_id` de chaque note qui porte la relation. Le front n'a **aucune**
//! entrée « Tous les espaces » côté données — c'est un mode d'affichage, pas un
//! espace : n'en créez donc pas un ici, des notes finiraient rangées dedans.
//!
//! # Ce qui reste à décider
//!
//! - **Un espace par défaut au premier lancement.** Sans espace, l'application
//!   refuse de créer une note (il n'y a nulle part où la ranger) et affiche
//!   « Créez d'abord un espace ». Créer un espace initial (« Perso », par ex.)
//!   au premier `list_spaces` évite cet écran vide ; c'est un choix produit.
//! - **La suppression et le renommage.** Aucune commande n'existe encore :
//!   supprimer un espace demande d'abord de trancher le sort de ses notes
//!   (suppression en cascade, ou déplacement vers un espace par défaut).
//!   Le champ `spaceId` d'une note est déjà modifiable via `NotePatch`, donc le
//!   déplacement ne demanderait qu'une commande et une entrée de menu.

use serde::{Deserialize, Serialize};

const NOT_IMPLEMENTED: &str =
    "Commande non implémentée : voir les TODO de src-tauri/src/commands/spaces.rs";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Space {
    pub id: String,
    /// Nom affiché dans le sélecteur. Le front refuse déjà les homonymes à la
    /// création ; à vous de décider si la persistance impose la même contrainte.
    pub name: String,
}

/// Création : pas d'identifiant, il est attribué ici.
#[allow(dead_code)] // TODO: à retirer une fois `create_space` écrite (elle lira `name`).
#[derive(Debug, Clone, Deserialize)]
pub struct SpaceDraft {
    pub name: String,
}

/// TODO: lire les espaces persistés. Voir la note ci-dessus sur l'espace créé
/// d'office au premier lancement.
#[tauri::command]
pub fn list_spaces() -> Result<Vec<Space>, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// TODO: attribuer un identifiant unique, persister, renvoyer l'espace créé.
/// Le front le sélectionne aussitôt à partir de la valeur renvoyée.
#[tauri::command]
#[allow(unused_variables)] // TODO: à retirer une fois le corps écrit.
pub fn create_space(draft: SpaceDraft) -> Result<Space, String> {
    Err(NOT_IMPLEMENTED.to_string())
}
