//! Barre système et raccourcis globaux : de la glu Tauri, pas une feature.
//!
//! **Rien de ce qui est visible par l'utilisateur n'est écrit ici** : les libellés
//! du menu arrivent du front déjà traduits.

use serde::Deserialize;
use specta::Type;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Miroirs de `core/ipc/app-events.service.ts` : une faute de frappe y produirait
/// un abonnement silencieusement inerte.
const CAPTURE_EVENT: &str = "devbox:capture";
const NEW_NOTE_EVENT: &str = "devbox:new-note";

/// `unminimize` d'abord : une fenêtre réduite qu'on se contente de montrer reste
/// dans la barre des tâches.
pub(crate) fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Montre la fenêtre **puis** demande l'action au front : le natif ne crée jamais
/// la note lui-même, ce qui lui évite de dupliquer la détection de langage.
fn reveal_and_emit(app: &AppHandle, topic: &str) {
    reveal(app);
    let _ = app.emit(topic, ());
}

// --- Raccourcis actifs hors de la fenêtre -----------------------------------

const CONTROL_ALT: Modifiers = Modifiers::CONTROL.union(Modifiers::ALT);

/// Un raccourci déjà pris par une autre application est journalisé mais **non
/// fatal** : DevBox doit démarrer sans.
pub(crate) fn register_shortcuts(app: &AppHandle) -> tauri::Result<()> {
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
                    CAPTURE_EVENT
                } else if shortcut == &new_note {
                    NEW_NOTE_EVENT
                } else {
                    return;
                };

                reveal_and_emit(app, topic);
            })
            .build(),
    )?;

    for shortcut in [capture, new_note] {
        if let Err(error) = app.global_shortcut().register(shortcut) {
            log::warn!("Raccourci global {shortcut:?} indisponible : {error}");
        }
    }

    Ok(())
}

// --- Barre système : l'icône, son menu, et ce que ses entrées déclenchent ----

const TRAY_ID: &str = "devbox";

const OPEN_ITEM: &str = "open";
const NEW_NOTE_ITEM: &str = "new-note";
const CAPTURE_ITEM: &str = "capture";
const QUIT_ITEM: &str = "quit";

/// Les libellés traversent le pont **déjà traduits** : la langue de l'interface
/// est une préférence du front, et une table de traductions en Rust en ferait une
/// seconde à tenir.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub open: String,
    pub new_note: String,
    pub capture: String,
    pub quit: String,
}

/// Crée l'icône, ou remplace seulement son menu si elle existe déjà — un
/// changement de langue la retraduit ainsi sans la faire clignoter.
///
/// Ne renvoie **pas** de `Result` : une barre système absente n'est pas une panne
/// que le front puisse traiter, et lui inventer un code ajouterait une branche
/// que rien n'afficherait. L'échec est journalisé côté natif, et [`tray_exists`]
/// empêche alors la fermeture de cacher la fenêtre là où plus rien ne saurait la
/// rappeler.
#[tauri::command]
#[specta::specta]
// Une commande reçoit ses arguments désérialisés depuis la charge utile IPC :
// ils arrivent possédés, qu'elle les consomme ou non.
#[allow(clippy::needless_pass_by_value)]
pub fn sync_tray(labels: TrayLabels, app: AppHandle) {
    let menu = match build_menu(&app, &labels) {
        Ok(menu) => menu,
        Err(error) => {
            log::warn!("Menu de la barre système indisponible : {error}");
            return;
        }
    };

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(error) = tray.set_menu(Some(menu)) {
            log::warn!("Menu de la barre système non mis à jour : {error}");
        }
        return;
    }

    if let Err(error) = build_tray(&app, &menu) {
        log::warn!("Barre système indisponible : {error}");
    }
}

pub(crate) fn tray_exists(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

fn build_menu(app: &AppHandle, labels: &TrayLabels) -> tauri::Result<Menu<Wry>> {
    let open = MenuItem::with_id(app, OPEN_ITEM, &labels.open, true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, NEW_NOTE_ITEM, &labels.new_note, true, None::<&str>)?;
    let capture = MenuItem::with_id(app, CAPTURE_ITEM, &labels.capture, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, &labels.quit, true, None::<&str>)?;

    Menu::with_items(app, &[&open, &new_note, &capture, &separator, &quit])
}

fn build_tray(app: &AppHandle, menu: &Menu<Wry>) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or(tauri::Error::UnknownPath)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("DevBox")
        // Le clic gauche montre la fenêtre ; le menu reste au clic droit, où
        // Windows l'attend.
        .show_menu_on_left_click(false)
        .menu(menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ITEM => reveal(app),
            NEW_NOTE_ITEM => reveal_and_emit(app, NEW_NOTE_EVENT),
            CAPTURE_ITEM => reveal_and_emit(app, CAPTURE_EVENT),
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
