// Publics : `tests/` est un crate à part, qui ne voit du binaire que son API.
pub mod db;
pub mod error;
pub mod notes;
pub mod spaces;

#[cfg(desktop)]
pub mod desktop;

use tauri::Manager;
use tauri_specta::{Builder, collect_commands};

use desktop::sync_tray;
use notes::{create_note, delete_note, query_notes, update_note};
use spaces::{create_space, delete_space, list_spaces, rename_space};

/// Résolu depuis le manifeste et non du répertoire courant : ni `tauri dev` ni
/// `cargo run --manifest-path` ne garantissent lequel c'est, et un chemin relatif
/// écrivait le fichier à côté du dépôt sans rien signaler.
const BINDINGS_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/app/core/ipc/bindings.ts"
);

/// Réécrit `bindings.ts` sans lancer l'application.
///
/// ⚠️ Pas un `#[cfg(test)]` : sous Windows l'exécutable de test vit dans
/// `target/debug/deps/`, sans le `WebView2Loader.dll` que lier `export` exige —
/// le binaire de test n'y démarre plus du tout.
pub fn export_bindings() -> Result<(), specta_typescript::Error> {
    ipc_builder().export(specta_typescript::Typescript::default(), BINDINGS_PATH)
}

/// Source **unique** des signatures : cette liste enregistre auprès de Tauri
/// *et* écrit `bindings.ts`. Une commande qui n'y est pas n'existe nulle part.
fn ipc_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = ipc_builder();

    // Pas en release : le `src/` du front n'existe pas à côté d'un binaire installé.
    #[cfg(debug_assertions)]
    export_bindings().expect("échec de la génération des bindings TypeScript");

    tauri::Builder::default()
        // En premier : les plugins suivants journalisent déjà.
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Absent des cibles mobiles (voir Cargo.toml).
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // Idem. La barre système, elle, n'est pas créée ici : elle attend
            // du front ses libellés traduits.
            #[cfg(desktop)]
            desktop::register_shortcuts(app.handle())?;

            // Seul emplacement inscriptible garanti une fois l'app installée.
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;

            let connection = db::open(&directory.join(db::DB_FILE_NAME))?;
            app.manage(db::Db::new(connection));

            Ok(())
        })
        // Fermer range dans la barre système au lieu de quitter — l'application
        // est faite pour rester à portée de raccourci.
        //
        // ⚠️ Uniquement s'il y a une barre système où la retrouver : sans elle,
        // cacher la fenêtre laisserait un processus que plus rien ne rappelle.
        .on_window_event(
            // Le préfixe `_` garde la compilation mobile silencieuse.
            #[allow(clippy::used_underscore_binding)]
            |_window, _event| {
                #[cfg(desktop)]
                if let tauri::WindowEvent::CloseRequested { api, .. } = _event
                    && desktop::tray_exists(_window.app_handle())
                {
                    api.prevent_close();
                    let _ = _window.hide();
                }
            },
        )
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
