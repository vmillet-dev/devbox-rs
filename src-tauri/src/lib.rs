mod commands;
mod domain;
mod storage;

use std::sync::Mutex;

use tauri::Manager;

use commands::notes::{create_note, delete_note, query_notes, update_note};
use commands::spaces::{create_space, delete_space, list_spaces, rename_space};

/// Événements poussés vers le front. Miroir de `core/ipc/app-events.service.ts`,
/// où une faute de frappe produirait un abonnement silencieusement inerte.
#[cfg(desktop)]
mod events {
    pub const CAPTURE: &str = "devbox:capture";
    pub const NEW_NOTE: &str = "devbox:new-note";
}

/// Raccourcis actifs hors de la fenêtre : c'est ce qui remplace le réflexe
/// « j'ouvre le Bloc-notes ».
///
/// Le Rust ne crée pas la note — il montre la fenêtre et prévient. La création
/// reste au front, qui passe par `create_note` comme pour toute autre note et
/// profite donc de la détection de langage sans la dupliquer ici.
///
/// Un enregistrement qui échoue (raccourci déjà pris par une autre application)
/// est signalé mais **non fatal** : DevBox doit démarrer sans son raccourci.
#[cfg(desktop)]
fn register_shortcuts(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    const CONTROL_ALT: Modifiers = Modifiers::CONTROL.union(Modifiers::ALT);
    let capture = Shortcut::new(Some(CONTROL_ALT), Code::KeyV);
    let new_note = Shortcut::new(Some(CONTROL_ALT), Code::KeyN);

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                // Sans ce filtre le relâchement rejouerait l'action.
                if event.state() != ShortcutState::Pressed {
                    return;
                }

                let topic = if shortcut == &capture {
                    events::CAPTURE
                } else if shortcut == &new_note {
                    events::NEW_NOTE
                } else {
                    return;
                };

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit(topic, ());
            })
            .build(),
    )?;

    for shortcut in [capture, new_note] {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            eprintln!("Raccourci global {shortcut:?} indisponible : {error}");
        }
    }

    Ok(())
}

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
            // clavier hors de sa fenêtre.
            #[cfg(desktop)]
            register_shortcuts(app.handle())?;

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
