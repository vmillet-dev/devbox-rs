//! The changelog shipped with the binary: what "Nouveautés" shows.
//!
//! This file holds the command; [`model`] holds the types and the reading of the
//! Markdown. There is no `store.rs`: nothing is persisted, the whole feature is
//! one file baked into the executable.

pub mod model;

use model::ChangelogRelease;

/// The repository's `CHANGELOG.md`, embedded at build time.
///
/// Resolved from the manifest and not from the current directory, for the same
/// reason as `BINDINGS_PATH`: neither `tauri dev` nor `cargo run
/// --manifest-path` guarantees which directory that is.
///
/// This is the one place user-facing text comes out of Rust, and the exception
/// is deliberate: it is *data* shipped as a file, untranslated on purpose —
/// exactly like the release notes the updater hands over.
const CHANGELOG: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../CHANGELOG.md"));

/// Newest release first, as the file lists them.
#[tauri::command]
#[specta::specta]
pub fn app_changelog() -> Vec<ChangelogRelease> {
    model::parse(CHANGELOG)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_file_parses_into_something_to_show() {
        // A changelog reshaped until it no longer parses would leave the panel
        // empty, and nothing else would say so.
        let releases = app_changelog();

        assert!(!releases.is_empty(), "the file describes no release");
        for release in &releases {
            assert!(
                !release.sections.is_empty(),
                "release {} carries no entry",
                release.version
            );
            for section in &release.sections {
                // An empty heading would draw a rule under nothing.
                assert!(
                    !section.items.is_empty(),
                    "section {} of {} is an empty heading",
                    section.title,
                    release.version
                );
            }
        }
    }
}
