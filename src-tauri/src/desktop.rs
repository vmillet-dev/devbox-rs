//! Barre système et raccourcis globaux : de la glu Tauri, hors des trois couches.
//! `commands` appelle `desktop`, jamais l'inverse.
//!
//! **Rien de ce qui est visible par l'utilisateur n'est écrit ici** : les libellés
//! du menu arrivent du front déjà traduits.

pub(crate) mod shortcut;
pub(crate) mod tray;

use tauri::{AppHandle, Emitter, Manager};

/// Miroir de `core/ipc/app-events.service.ts` : une faute de frappe y produirait
/// un abonnement silencieusement inerte.
pub(crate) mod events {
    pub(crate) const CAPTURE: &str = "devbox:capture";
    pub(crate) const NEW_NOTE: &str = "devbox:new-note";
}

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
