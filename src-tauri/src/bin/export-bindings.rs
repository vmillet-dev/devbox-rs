//! Régénère `bindings.ts` sans ouvrir de fenêtre — `npm run tauri dev` le fait
//! déjà au lancement, mais travailler côté front sans démarrer l'app est courant.

fn main() {
    devbox_lib::export_bindings().expect("échec de la génération des bindings TypeScript");
    println!("bindings.ts régénéré");
}
