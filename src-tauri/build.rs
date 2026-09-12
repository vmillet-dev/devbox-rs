use std::{env, fs, path::Path};

fn main() {
    export_metadata();
    tauri_build::build();
}

/// Cargo does not pass `[package.metadata]` to the crate, so it is read here and handed
/// over as environment variables the code reads with `env!` — resolved at compile time,
/// and the manifest stays the only place these values are written.
fn export_metadata() {
    println!("cargo:rerun-if-changed=Cargo.toml");

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo");
    let text = fs::read_to_string(Path::new(&manifest_dir).join("Cargo.toml"))
        .expect("Cargo.toml is readable");
    let manifest: toml::Table = toml::from_str(&text).expect("Cargo.toml is valid TOML");

    let metadata = manifest
        .get("package")
        .and_then(|package| package.get("metadata"))
        .and_then(|metadata| metadata.get("devbox"))
        .expect("Cargo.toml declares [package.metadata.devbox]");

    for key in ["display-name", "author-handle"] {
        let value = metadata
            .get(key)
            .and_then(toml::Value::as_str)
            .unwrap_or_else(|| panic!("[package.metadata.devbox] {key} is a string"));
        let name = format!("DEVBOX_{}", key.to_uppercase().replace('-', "_"));

        println!("cargo:rustc-env={name}={value}");
    }

    // Cargo joins `authors` with `;`; the about card names one person.
    let authors = env::var("CARGO_PKG_AUTHORS").unwrap_or_default();
    let author = authors.split(';').next().unwrap_or_default();

    println!("cargo:rustc-env=DEVBOX_AUTHOR={author}");
}
