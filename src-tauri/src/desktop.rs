//! Intégration au bureau : raccourcis globaux et barre système.
//!
//! Ni règle métier ni persistance — que de la glu Tauri, d'où un module à part
//! plutôt qu'une place dans `commands/ → domain/ ← storage/`, dont il ne fait
//! pas partie. Il ne dépend d'aucun des trois.
//!
//! **Rien de ce qui est visible par l'utilisateur n'est écrit ici.** Les
//! libellés du menu arrivent du front déjà traduits (`core/tray/tray.service.ts`),
//! parce que la langue de l'interface est une préférence du front et qu'une
//! table de traductions en Rust serait une seconde source à tenir.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::commands::tray::TrayLabels;

/// Événements poussés vers le front. Miroir de `core/ipc/app-events.service.ts`,
/// où une faute de frappe produirait un abonnement silencieusement inerte.
pub mod events {
    pub const CAPTURE: &str = "devbox:capture";
    pub const NEW_NOTE: &str = "devbox:new-note";
}

pub const TRAY_ID: &str = "devbox";

const OPEN_ITEM: &str = "open";
const NEW_NOTE_ITEM: &str = "new-note";
const CAPTURE_ITEM: &str = "capture";
const QUIT_ITEM: &str = "quit";

/// Ramène la fenêtre au premier plan. `unminimize` d'abord : une fenêtre réduite
/// que l'on se contente de montrer reste dans la barre des tâches.
pub fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Montre la fenêtre **puis** demande l'action au front.
///
/// Le natif ne crée jamais la note lui-même : la création reste au front, qui
/// passe par `create_note` comme pour n'importe quelle autre note et profite
/// donc de la détection de langage sans la dupliquer ici.
fn reveal_and_emit(app: &AppHandle, topic: &str) {
    reveal(app);
    let _ = app.emit(topic, ());
}

/// Vrai quand l'icône de la barre système existe déjà.
pub fn has_tray(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

/// Crée l'icône de la barre système, ou remplace seulement son menu si elle
/// existe déjà — c'est ce qui permet à un changement de langue de la retraduire
/// sans la faire clignoter.
///
/// Best effort : une barre système absente (autre environnement de bureau,
/// session restreinte) est signalée et ignorée. L'application reste entièrement
/// utilisable dans sa fenêtre, et [`has_tray`] empêche la fermeture de la cacher
/// là où plus rien ne saurait la rappeler.
pub fn sync_tray(app: &AppHandle, labels: &TrayLabels) {
    let menu = match build_menu(app, labels) {
        Ok(menu) => menu,
        Err(error) => {
            eprintln!("Menu de la barre système indisponible : {error}");
            return;
        }
    };

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(error) = tray.set_menu(Some(menu)) {
            eprintln!("Menu de la barre système non mis à jour : {error}");
        }
        return;
    }

    if let Err(error) = build_tray(app, menu) {
        eprintln!("Barre système indisponible : {error}");
    }
}

fn build_menu(app: &AppHandle, labels: &TrayLabels) -> tauri::Result<Menu<Wry>> {
    let open = MenuItem::with_id(app, OPEN_ITEM, &labels.open, true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, NEW_NOTE_ITEM, &labels.new_note, true, None::<&str>)?;
    let capture = MenuItem::with_id(app, CAPTURE_ITEM, &labels.capture, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, &labels.quit, true, None::<&str>)?;

    Menu::with_items(app, &[&open, &new_note, &capture, &separator, &quit])
}

fn build_tray(app: &AppHandle, menu: Menu<Wry>) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::UnknownPath)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("DevBox")
        // Le clic gauche montre la fenêtre ; le menu reste au clic droit, où
        // Windows l'attend.
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ITEM => reveal(app),
            NEW_NOTE_ITEM => reveal_and_emit(app, events::NEW_NOTE),
            CAPTURE_ITEM => reveal_and_emit(app, events::CAPTURE),
            // Le seul chemin qui termine réellement le processus : la croix de
            // la fenêtre ne fait que la cacher.
            QUIT_ITEM => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Raccourcis actifs hors de la fenêtre : c'est ce qui remplace le réflexe
/// « j'ouvre le Bloc-notes ».
///
/// Un enregistrement qui échoue (raccourci déjà pris par une autre application)
/// est signalé mais **non fatal** : DevBox doit démarrer sans son raccourci.
pub fn register_shortcuts(app: &AppHandle) -> tauri::Result<()> {
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

                reveal_and_emit(app, topic);
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
