//! Tray and global shortcuts: Tauri glue, not a feature.
//!
//! **Nothing user-visible is written here**: the menu labels arrive from the
//! front end already translated.

use serde::Deserialize;
use specta::Type;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Mirrors of `core/ipc/app-events.service.ts`: a typo here would produce a
/// silently inert subscription.
const CAPTURE_EVENT: &str = "devbox:capture";
const NEW_NOTE_EVENT: &str = "devbox:new-note";

/// `unminimize` first: a minimised window that is merely shown stays in the
/// taskbar.
pub(crate) fn reveal(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Shows the window **then** asks the front for the action: the native side
/// never creates the note itself, which spares it from duplicating language
/// detection.
fn reveal_and_emit(app: &AppHandle, topic: &str) {
    reveal(app);
    let _ = app.emit(topic, ());
}

// --- Shortcuts active outside the window ------------------------------------

const CONTROL_ALT: Modifiers = Modifiers::CONTROL.union(Modifiers::ALT);

/// A shortcut already taken by another application is logged but **not fatal**:
/// DevBox must start without it.
pub(crate) fn register_shortcuts(app: &AppHandle) -> tauri::Result<()> {
    let capture = Shortcut::new(Some(CONTROL_ALT), Code::KeyV);
    let new_note = Shortcut::new(Some(CONTROL_ALT), Code::KeyN);

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                // Without this filter the key release would replay the action.
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
            log::warn!("Global shortcut {shortcut:?} unavailable: {error}");
        }
    }

    Ok(())
}

// --- System tray: icon, menu, and item actions --------------------------------

const TRAY_ID: &str = "devbox";

const OPEN_ITEM: &str = "open";
const NEW_NOTE_ITEM: &str = "new-note";
const CAPTURE_ITEM: &str = "capture";
const QUIT_ITEM: &str = "quit";

/// Labels cross the bridge **already translated**: the interface language
/// is a front-end preference, and keeping a translation table in Rust would
/// mean maintaining a second one.
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub open: String,
    pub new_note: String,
    pub capture: String,
    pub quit: String,
}

/// Creates the icon, or replaces only its menu if it already exists — a
/// language change thus re-translates it without making it flicker.
///
/// Does **not** return a `Result`: an absent system tray is not a failure
/// the front end can handle, and inventing a code for it would add a branch
/// that nothing would display. The failure is logged on the native side, and
/// [`tray_exists`] then prevents closing from hiding the window where nothing
/// could call it back.
#[tauri::command]
#[specta::specta]
// A command receives its arguments deserialized from the IPC payload:
// they arrive owned, whether it consumes them or not.
#[allow(clippy::needless_pass_by_value)]
pub fn sync_tray(labels: TrayLabels, app: AppHandle) {
    let menu = match build_menu(&app, &labels) {
        Ok(menu) => menu,
        Err(error) => {
            log::warn!("System tray menu unavailable: {error}");
            return;
        }
    };

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Err(error) = tray.set_menu(Some(menu)) {
            log::warn!("System tray menu not updated: {error}");
        }
        return;
    }

    if let Err(error) = build_tray(&app, &menu) {
        log::warn!("System tray unavailable: {error}");
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
        // Left click shows the window; the menu remains on right click, where
        // Windows expects it.
        .show_menu_on_left_click(false)
        .menu(menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ITEM => reveal(app),
            NEW_NOTE_ITEM => reveal_and_emit(app, NEW_NOTE_EVENT),
            CAPTURE_ITEM => reveal_and_emit(app, CAPTURE_EVENT),
            // The only path that actually terminates the process: the window's
            // close button only hides it.
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
