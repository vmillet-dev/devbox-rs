//! Module "Crypto & Hashing" (à implémenter).
//!
//! Idées de commandes à venir :
//! - `hash_sha256(input: String) -> String`
//! - `hash_md5(input: String) -> String`
//! - `generate_uuid() -> String`
//!
//! Ces fonctions n'ont besoin d'aucun état partagé : ce sont de simples
//! fonctions pures, faciles à tester indépendamment de Tauri.

// Squelette d'exemple, pas encore branché au front-end ni enregistré dans lib.rs.
#[allow(dead_code)]
#[tauri::command]
pub fn hash_placeholder(input: String) -> String {
    // TODO: brancher un vrai algorithme, par ex. avec la crate `sha2`
    format!("hash-a-implementer({input})")
}
