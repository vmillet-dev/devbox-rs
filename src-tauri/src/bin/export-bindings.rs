//! Regenerates `bindings.ts` without opening a window; `npm run tauri dev` does it too.

fn main() {
    devbox_lib::export_bindings().expect("failed to generate TypeScript bindings");
    println!("bindings.ts regenerated");
}
