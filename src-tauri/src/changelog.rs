pub mod model;

use model::ChangelogRelease;

/// Resolved from the manifest, for the same reason as `BINDINGS_PATH`. ⚠️ The one place
/// user-facing text comes out of Rust: it is data shipped as a file, untranslated like
/// the release notes the updater hands over.
const CHANGELOG: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../CHANGELOG.md"));

#[tauri::command(async)]
#[specta::specta]
pub fn app_changelog() -> Vec<ChangelogRelease> {
    model::parse(CHANGELOG)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_file_parses_into_something_to_show() {
        let releases = app_changelog();

        assert!(!releases.is_empty(), "the file describes no release");
        for release in &releases {
            assert!(
                !release.sections.is_empty(),
                "release {} carries no entry",
                release.version
            );
            for section in &release.sections {
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
