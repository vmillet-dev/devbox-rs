//! What the application says about itself: the standard `Cargo.toml` fields through
//! `CARGO_PKG_*`, and what Cargo has no field for through `[package.metadata.devbox]`
//! and `rust-toolchain.toml`, both read by `build.rs`.
//!
//! Its own version and Tauri's are absent on purpose — the front asks the running
//! binary, which cannot go stale the way a committed `bindings.ts` can.

use serde::Serialize;
use specta::Type;

/// Reaches the front as the `APP_METADATA` constant of `bindings.ts`, so the titlebar
/// and the about card read it synchronously — a command would show an empty name for
/// the length of a round trip.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppMetadata {
    /// What the user is shown, which is not the crate name (`devbox`).
    pub name: &'static str,
    /// ⚠️ Must stay covered by the scope declared for `opener:allow-open-url` in
    /// `capabilities/default.json`, or opening it is refused at runtime.
    pub repository: &'static str,
    pub author: &'static str,
    pub author_handle: &'static str,
    /// The toolchain the project pins, for the about card.
    pub rust_version: &'static str,
}

pub const METADATA: AppMetadata = AppMetadata {
    name: env!("DEVBOX_DISPLAY_NAME"),
    repository: env!("CARGO_PKG_REPOSITORY"),
    author: env!("DEVBOX_AUTHOR"),
    author_handle: env!("DEVBOX_AUTHOR_HANDLE"),
    rust_version: env!("DEVBOX_RUST_VERSION"),
};
