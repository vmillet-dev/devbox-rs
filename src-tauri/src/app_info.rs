//! ⚠️ What Cargo has no field for comes from `[package.metadata.devbox]` and
//! `rust-toolchain.toml`, both read by `build.rs` — Cargo does not pass
//! `[package.metadata]` to the crate.
//!
//! Its own version and Tauri's are absent on purpose: the front asks the running binary,
//! which cannot go stale the way a committed `bindings.ts` can.

use serde::Serialize;
use specta::Type;

/// A constant of `bindings.ts` and not a command: the titlebar reads the name
/// synchronously, and a round trip would show an empty one first.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppMetadata {
    /// What the user is shown, which is not the crate name (`devbox`).
    pub(crate) name: &'static str,
    /// ⚠️ Must stay covered by the scope declared for `opener:allow-open-url` in
    /// `capabilities/default.json`, or opening it is refused at runtime.
    pub(crate) repository: &'static str,
    pub(crate) author: &'static str,
    pub(crate) author_handle: &'static str,
    /// The toolchain the project pins, for the about card.
    pub(crate) rust_version: &'static str,
}

pub(crate) const METADATA: AppMetadata = AppMetadata {
    name: env!("DEVBOX_DISPLAY_NAME"),
    repository: env!("CARGO_PKG_REPOSITORY"),
    author: env!("DEVBOX_AUTHOR"),
    author_handle: env!("DEVBOX_AUTHOR_HANDLE"),
    rust_version: env!("DEVBOX_RUST_VERSION"),
};
