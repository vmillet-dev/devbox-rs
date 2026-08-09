//! Regenerates `bindings.ts` without opening a window — `npm run tauri dev`
//! already does it at launch, but working on the front end without starting the
//! app is common.

fn main() {
    devbox_lib::export_bindings().expect("failed to generate TypeScript bindings");
    println!("bindings.ts regenerated");
}
