//! Barre système : l'icône, son menu, et ce que ses entrées déclenchent.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

use super::{events, reveal, reveal_and_emit};

pub(crate) const TRAY_ID: &str = "devbox";

const OPEN_ITEM: &str = "open";
const NEW_NOTE_ITEM: &str = "new-note";
const CAPTURE_ITEM: &str = "capture";
const QUIT_ITEM: &str = "quit";

/// Type propre à ce module plutôt que le DTO de `commands::tray` : c'est ce qui
/// garde la dépendance à sens unique.
pub(crate) struct MenuLabels<'a> {
    pub open: &'a str,
    pub new_note: &'a str,
    pub capture: &'a str,
    pub quit: &'a str,
}

pub(crate) fn exists(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

/// Crée l'icône, ou remplace seulement son menu si elle existe déjà — un
/// changement de langue la retraduit ainsi sans la faire clignoter.
///
/// Best effort : une barre système absente est journalisée et ignorée.
/// [`exists`] empêche alors la fermeture de cacher la fenêtre là où plus rien ne
/// saurait la rappeler.
pub(crate) fn sync(app: &AppHandle, labels: &MenuLabels<'_>) {
    let menu = match build_menu(app, labels) {
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

    if let Err(error) = build_tray(app, &menu) {
        log::warn!("Barre système indisponible : {error}");
    }
}

fn build_menu(app: &AppHandle, labels: &MenuLabels<'_>) -> tauri::Result<Menu<Wry>> {
    let open = MenuItem::with_id(app, OPEN_ITEM, labels.open, true, None::<&str>)?;
    let new_note = MenuItem::with_id(app, NEW_NOTE_ITEM, labels.new_note, true, None::<&str>)?;
    let capture = MenuItem::with_id(app, CAPTURE_ITEM, labels.capture, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, labels.quit, true, None::<&str>)?;

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
