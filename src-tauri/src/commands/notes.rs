//! Module "Prise de notes" (à implémenter).
//!
//! Idées de commandes à venir :
//! - `list_notes() -> Vec<Note>`
//! - `create_note(titre: String, contenu: String) -> Note`
//! - `delete_note(id: String)`
//!
//! Astuce : gardez la logique métier (lecture/écriture disque, base SQLite, etc.)
//! dans des fonctions Rust "pures" séparées de Tauri, et faites de vos
//! `#[tauri::command]` de simples adaptateurs qui les appellent.
//! Cela facilite grandement les tests unitaires.

// Squelette d'exemple, pas encore branché au front-end ni enregistré dans lib.rs.
#[allow(dead_code)]
#[tauri::command]
pub fn list_notes_placeholder() -> Vec<String> {
    // TODO: remplacer par une vraie source de données (fichiers, SQLite, etc.)
    vec![]
}
