mod commands;
#[cfg(desktop)]
mod desktop;
mod domain;
mod storage;

use std::sync::Mutex;

use tauri::Manager;

use commands::notes::{create_note, delete_note, query_notes, update_note};
use commands::spaces::{create_space, delete_space, list_spaces, rename_space};
use commands::tray::sync_tray;

/// Point d'entrée de l'application, natif sur mobile via `mobile_entry_point`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // L'updater est absent des cibles mobiles (voir Cargo.toml), sinon
            // la compilation Android/iOS bute sur un crate inconnu.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // Idem : un système mobile ne laisse pas une application écouter le
            // clavier hors de sa fenêtre. La barre système, elle, n'est pas
            // créée ici — elle attend du front ses libellés traduits.
            #[cfg(desktop)]
            desktop::register_shortcuts(app.handle())?;

            // Seul emplacement inscriptible garanti une fois l'app installée.
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;

            // Connexion unique derrière un mutex : `Connection` n'est pas
            // `Sync`, et deux commandes peuvent se chevaucher.
            let connection = storage::open(&directory.join(storage::DB_FILE_NAME))?;
            app.manage(Mutex::new(connection));

            Ok(())
        })
        // Fermer range dans la barre système au lieu de quitter : l'application
        // est faite pour rester à portée de raccourci, et la quitter à chaque
        // fois rendrait `Ctrl+Alt+V` inutile.
        //
        // ⚠️ Uniquement s'il y a une barre système où la retrouver. Sans elle,
        // cacher la fenêtre laisserait un processus que plus rien ne rappelle.
        .on_window_event(|_window, _event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event
                && desktop::has_tray(_window.app_handle())
            {
                api.prevent_close();
                let _ = _window.hide();
            }
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
            sync_tray,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
