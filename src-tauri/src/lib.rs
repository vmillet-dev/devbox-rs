// Déclare le dossier `commands/` comme module Rust (voir commands/mod.rs).
mod commands;

use commands::greetings::saluer;
use commands::notes::{create_note, delete_note, list_notes, update_note};
use commands::spaces::{create_space, list_spaces};

/// Point d'entrée de l'application Tauri.
/// Sur mobile, cette même fonction sert aussi de point d'entrée natif
/// (voir l'attribut `mobile_entry_point` ci-dessous).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Chaque nouvelle commande doit être ajoutée ici pour devenir
        // accessible depuis Angular via invoke("nom_de_la_commande", ...).
        // Les commandes de notes et d'espaces sont enregistrées mais leur corps
        // reste à écrire : elles répondent une erreur explicite en attendant.
        .invoke_handler(tauri::generate_handler![
            saluer,
            list_notes,
            create_note,
            update_note,
            delete_note,
            list_spaces,
            create_space,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
