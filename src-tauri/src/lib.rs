// Déclare le dossier `commands/` comme module Rust (voir commands/mod.rs).
mod commands;

use commands::greetings::saluer;

/// Point d'entrée de l'application Tauri.
/// Sur mobile, cette même fonction sert aussi de point d'entrée natif
/// (voir l'attribut `mobile_entry_point` ci-dessous).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Chaque nouvelle commande doit être ajoutée ici pour devenir
        // accessible depuis Angular via invoke("nom_de_la_commande", ...).
        .invoke_handler(tauri::generate_handler![saluer])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
