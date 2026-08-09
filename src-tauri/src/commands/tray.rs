//! Commande « barre système ».
//!
//! Les libellés traversent le pont **déjà traduits** : la langue de l'interface
//! est une préférence du front, et une table de traductions en Rust en ferait une
//! seconde à tenir.

use serde::Deserialize;
use specta::Type;
use tauri::AppHandle;

use crate::desktop::tray::{self, MenuLabels};

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub open: String,
    pub new_note: String,
    pub capture: String,
    pub quit: String,
}

impl TrayLabels {
    fn as_menu_labels(&self) -> MenuLabels<'_> {
        MenuLabels {
            open: &self.open,
            new_note: &self.new_note,
            capture: &self.capture,
            quit: &self.quit,
        }
    }
}

/// Ne renvoie **pas** de `Result` : une barre système absente n'est pas une panne
/// que le front puisse traiter, et lui inventer un code ajouterait une branche
/// que rien n'afficherait. L'échec est journalisé côté natif.
#[tauri::command]
#[specta::specta]
pub fn sync_tray(labels: TrayLabels, app: AppHandle) {
    tray::sync(&app, &labels.as_menu_labels());
}
