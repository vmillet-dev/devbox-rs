//! Module "Encodage & Formatage" (à implémenter).
//!
//! Idées de commandes à venir :
//! - `encode_base64(input: String) -> String`
//! - `decode_base64(input: String) -> Result<String, String>`
//! - `format_json(input: String) -> Result<String, String>`

// Squelette d'exemple, pas encore branché au front-end ni enregistré dans lib.rs.
#[allow(dead_code)]
#[tauri::command]
pub fn encode_base64_placeholder(input: String) -> String {
    // TODO: brancher un vrai encodage, par ex. avec la crate `base64`
    input
}
