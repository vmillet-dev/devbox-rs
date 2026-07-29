mod commands;
mod domain;
mod storage;

use std::sync::Mutex;

use tauri::Manager;

use commands::notes::{create_note, delete_note, query_notes, update_note};
use commands::spaces::{create_space, delete_space, list_spaces, rename_space};

/// Point d'entrée de l'application, natif sur mobile via `mobile_entry_point`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // L'updater est absent des cibles mobiles (voir Cargo.toml), sinon
            // la compilation Android/iOS bute sur un crate inconnu.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // Seul emplacement inscriptible garanti une fois l'app installée.
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;

            // Connexion unique derrière un mutex : `Connection` n'est pas
            // `Sync`, et deux commandes peuvent se chevaucher.
            let connection = storage::open(&directory.join(storage::DB_FILE_NAME))?;
            app.manage(Mutex::new(connection));

            Ok(())
        })
        // Sans enregistrement ici, `invoke()` échoue sur « command not found ».
        .invoke_handler(tauri::generate_handler![
            query_notes,
            create_note,
            update_note,
            delete_note,
            list_spaces,
            create_space,
            rename_space,
            delete_space,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
