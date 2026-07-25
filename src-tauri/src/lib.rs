// Déclare le dossier `commands/` comme module Rust (voir commands/mod.rs).
mod commands;
// Persistance SQLite (voir storage/mod.rs).
mod storage;

use std::sync::Mutex;

use tauri::Manager;

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
        .setup(|app| {
            // La base vit dans le répertoire de données de l'application, pas à
            // côté de l'exécutable : c'est le seul emplacement inscriptible
            // garanti une fois l'application installée.
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;

            // Connexion unique, partagée derrière un mutex : une `Connection`
            // rusqlite n'est pas `Sync`, et deux commandes peuvent se chevaucher.
            let connection = storage::open(&directory.join(storage::DB_FILE_NAME))?;
            app.manage(Mutex::new(connection));

            Ok(())
        })
        // Chaque nouvelle commande doit être ajoutée ici pour devenir
        // accessible depuis Angular via invoke("nom_de_la_commande", ...).
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
