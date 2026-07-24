//! Commandes de démonstration ("Hello World").
//! Sert de modèle minimal pour comprendre le pont Angular <-> Rust.

/// Salue une personne par son prénom.
///
/// Appelée depuis Angular via `invoke('saluer', { nom })`.
/// Le nom du paramètre Rust (`nom`) doit correspondre exactement
/// à la clé de l'objet passé côté TypeScript.
#[tauri::command]
pub fn saluer(nom: String) -> String {
    format!("Hello {nom} depuis le moteur Rust !")
}
