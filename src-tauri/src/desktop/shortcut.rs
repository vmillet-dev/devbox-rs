//! Raccourcis actifs hors de la fenêtre.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use super::{events, reveal_and_emit};

const CONTROL_ALT: Modifiers = Modifiers::CONTROL.union(Modifiers::ALT);

/// Un raccourci déjà pris par une autre application est journalisé mais **non
/// fatal** : DevBox doit démarrer sans.
pub(crate) fn register(app: &AppHandle) -> tauri::Result<()> {
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
            log::warn!("Raccourci global {shortcut:?} indisponible : {error}");
        }
    }

    Ok(())
}
