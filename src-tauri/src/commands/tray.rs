//! Commande « barre système ».
//!
//! Les libellés traversent le pont **déjà traduits** : la langue de l'interface
//! est une préférence du front, et une table de traductions en Rust en ferait
//! une seconde à tenir en phase. Le natif ne fait que les afficher.

use serde::Deserialize;
use tauri::AppHandle;

use crate::desktop;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    pub open: String,
    pub new_note: String,
    pub capture: String,
    pub quit: String,
}

/// Ne renvoie **pas** de `Result` : une barre système absente n'est pas une
/// panne que le front puisse traiter, et lui inventer un code d'erreur
/// ajouterait une branche que rien n'afficherait jamais. L'échec est journalisé
/// côté natif, comme pour un raccourci global indisponible.
#[tauri::command]
pub fn sync_tray(labels: TrayLabels, app: AppHandle) {
    desktop::sync_tray(&app, &labels);
}
