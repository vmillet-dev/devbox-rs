//! ⚠️ What Cargo has no field for comes from `[package.metadata.devnotes]` and
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
    /// What the user is shown, which is not the crate name (`devnotes`).
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
    name: env!("DEVNOTES_DISPLAY_NAME"),
    repository: env!("CARGO_PKG_REPOSITORY"),
    author: env!("DEVNOTES_AUTHOR"),
    author_handle: env!("DEVNOTES_AUTHOR_HANDLE"),
    rust_version: env!("DEVNOTES_RUST_VERSION"),
};

#[cfg(test)]
mod tests {
    use super::METADATA;

    /// ⚠️ The comment on `repository` is a promise nothing checked. Tauri refuses an
    /// `openUrl` outside the scope at runtime, with nothing on screen to explain it, so
    /// moving the repository without widening the scope would only show up in someone's
    /// hands. Read from the shipped capability, next to the constant it constrains.
    #[test]
    fn the_repository_stays_inside_the_scope_the_capability_allows() {
        const CAPABILITY: &str = include_str!("../capabilities/default.json");

        let declared: serde_json::Value = serde_json::from_str(CAPABILITY).expect("valid JSON");
        let scopes = declared["permissions"]
            .as_array()
            .expect("a permissions array")
            .iter()
            .filter(|permission| permission["identifier"] == "opener:allow-open-url")
            .flat_map(|permission| permission["allow"].as_array().expect("an allow list"))
            .filter_map(|entry| entry["url"].as_str())
            .collect::<Vec<_>>();

        assert!(
            !scopes.is_empty(),
            "no opener:allow-open-url scope to check"
        );
        assert!(
            scopes.iter().any(|scope| match scope.strip_suffix('*') {
                Some(prefix) => METADATA.repository.starts_with(prefix),
                None => *scope == METADATA.repository,
            }),
            "{} is outside {scopes:?}",
            METADATA.repository
        );
    }
}
