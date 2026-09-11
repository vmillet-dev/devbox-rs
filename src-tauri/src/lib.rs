// Public: `tests/` is a separate crate, and sees nothing of the binary but its API.
pub mod attachments;
pub mod db;
pub mod error;
pub mod notes;
pub mod spaces;
pub mod transfer;

#[cfg(desktop)]
pub mod desktop;

use tauri::Manager;
use tauri_specta::{Builder, collect_commands};

use attachments::{
    attach_clipboard_image, attach_file, delete_attachment, list_attachments, open_attachment,
    read_attachment, save_attachment,
};
use desktop::{sync_tray, unavailable_shortcuts};
use notes::{
    create_note, delete_note, delete_notes, delete_tag, empty_trash, fill_placeholders, list_tags,
    list_trash, merge_tags, move_notes, purge_notes, query_notes, rename_tag, restore_notes,
    set_placeholder_values, tag_notes, update_note,
};
use spaces::{create_space, delete_space, list_spaces, rename_space};
use transfer::{export_notes, export_selection, import_notes, share_notes};

/// Resolved from the manifest and not from the current directory: neither `tauri dev`
/// nor `cargo run --manifest-path` guarantees which one that is, and a relative path
/// used to write the file next to the repository without saying a word.
const BINDINGS_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/app/core/ipc/bindings.ts"
);

/// Rewrites `bindings.ts` without launching the application.
///
/// ⚠️ Not a `#[cfg(test)]`: on Windows the test executable lives in
/// `target/debug/deps/`, without the `WebView2Loader.dll` that linking `export`
/// then requires — the test binary no longer starts at all.
pub fn export_bindings() -> Result<(), specta_typescript::Error> {
    ipc_builder().export(specta_typescript::Typescript::default(), BINDINGS_PATH)
}

/// The **single** source of the signatures: this list registers with Tauri
/// *and* writes `bindings.ts`. A command absent from it exists nowhere.
fn ipc_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        query_notes,
        create_note,
        update_note,
        delete_note,
        delete_notes,
        restore_notes,
        list_trash,
        purge_notes,
        empty_trash,
        move_notes,
        tag_notes,
        list_tags,
        rename_tag,
        merge_tags,
        delete_tag,
        fill_placeholders,
        set_placeholder_values,
        list_spaces,
        create_space,
        rename_space,
        delete_space,
        attach_file,
        attach_clipboard_image,
        list_attachments,
        read_attachment,
        open_attachment,
        save_attachment,
        delete_attachment,
        export_notes,
        export_selection,
        import_notes,
        share_notes,
        sync_tray,
        unavailable_shortcuts,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = ipc_builder();

    // Not in release: the front-end `src/` does not exist next to an installed binary.
    #[cfg(debug_assertions)]
    export_bindings().expect("failed to generate TypeScript bindings");

    tauri::Builder::default()
        // First: the plugins that follow already log.
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Absent from the mobile targets (see Cargo.toml).
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // Same. The tray itself is not created here: it waits for its
            // translated labels to arrive from the front end.
            #[cfg(desktop)]
            desktop::register_shortcuts(app.handle())?;

            // The only writable location guaranteed once the app is installed.
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;

            let connection = db::open(&directory.join(db::DB_FILE_NAME))?;
            app.manage(db::Db::new(connection));

            // La rétention de la corbeille s'applique même si personne n'ouvre
            // le panneau, et le balayage ramasse les fichiers qu'une copie
            // interrompue aurait laissés. Ni l'un ni l'autre n'est fatal.
            let handle = app.handle().clone();
            let db = handle.state::<db::Db>();
            notes::sweep_trash_at_startup(&handle, &db);
            if let Err(error) = attachments::sweep_orphan_files(&handle, &db) {
                log::warn!("Orphan attachment files not swept: {error}");
            }

            Ok(())
        })
        // Closing files the window away in the tray instead of quitting — the
        // application is meant to stay within reach of a shortcut.
        //
        // ⚠️ Only when there is a tray to find it in: without one, hiding the
        // window would leave a process that nothing can call back.
        .on_window_event(
            // The `_` prefix keeps the mobile build quiet.
            #[allow(clippy::used_underscore_binding)]
            |_window, _event| {
                #[cfg(desktop)]
                if let tauri::WindowEvent::CloseRequested { api, .. } = _event
                    && desktop::tray_exists(_window.app_handle())
                {
                    api.prevent_close();
                    let _ = _window.hide();
                }
            },
        )
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while launching the Tauri application");
}
