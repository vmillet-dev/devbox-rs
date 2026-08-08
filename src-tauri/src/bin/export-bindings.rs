//! Régénère `src/app/core/ipc/bindings.ts` sans ouvrir de fenêtre.
//!
//! `npm run tauri dev` le fait déjà au lancement, mais travailler côté front
//! sans démarrer l'application reste courant — et l'attente d'un build Tauri
//! complet pour une signature modifiée ne se justifie pas.

fn main() {
    devbox_lib::export_bindings().expect("échec de la génération des bindings TypeScript");
    println!("bindings.ts régénéré");
}
