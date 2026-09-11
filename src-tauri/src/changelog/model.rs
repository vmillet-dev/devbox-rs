//! Reading `CHANGELOG.md` into what a panel can render.
//!
//! The reading happens here rather than on the front end, for the usual reason:
//! the front receives a typed structure and renders it with the components it
//! already has — no Markdown renderer to pull in, no `innerHTML`, nothing for
//! the CSP to forbid.
//!
//! The grammar is deliberately thin, and the file is written to match it:
//! `## ` opens a release, `### ` opens a category, `- ` (or `* `) is an entry,
//! and a line that continues one is appended to it. Everything else — the
//! preamble, a blank line, a stray paragraph — is skipped rather than guessed
//! at.

use serde::Serialize;
use specta::Type;

/// One `## ` heading of the file, with everything listed under it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogRelease {
    /// `0.1.1`, or whatever the heading names — `Unreleased` included. The
    /// square brackets of the Keep a Changelog style are dropped.
    pub version: String,
    /// `None` when the heading carries no date; never invented.
    pub date: Option<String>,
    pub sections: Vec<ChangelogSection>,
}

/// One `### ` heading, or the anonymous one a release gets when it lists its
/// entries without a category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogSection {
    /// Empty for that anonymous category: the front then renders no heading.
    pub title: String,
    pub items: Vec<String>,
}

/// Newest release first — the order of the file, which is not re-sorted:
/// versions are strings here, and sorting them as such would put `0.10` before
/// `0.9`.
pub fn parse(markdown: &str) -> Vec<ChangelogRelease> {
    let mut releases: Vec<ChangelogRelease> = Vec::new();
    // A continuation line belongs to the entry above it, and only while one is
    // still open — a blank line closes it.
    let mut item_open = false;

    for line in markdown.lines() {
        let line = line.trim();

        if let Some(heading) = line.strip_prefix("## ") {
            let (version, date) = split_heading(heading);
            releases.push(ChangelogRelease {
                version,
                date,
                sections: Vec::new(),
            });
            item_open = false;
            continue;
        }

        // Nothing to attach to: the preamble sits above the first release.
        let Some(release) = releases.last_mut() else {
            continue;
        };

        if let Some(title) = line.strip_prefix("### ") {
            release.sections.push(ChangelogSection {
                title: title.trim().to_string(),
                items: Vec::new(),
            });
            item_open = false;
        } else if let Some(entry) = bullet(line) {
            section_of(release).items.push(entry.to_string());
            item_open = true;
        } else if line.is_empty() {
            item_open = false;
        } else if item_open
            && let Some(item) = release.sections.last_mut().and_then(|s| s.items.last_mut())
        {
            item.push(' ');
            item.push_str(line);
        }
    }

    releases
}

/// The category entries land in, opening an anonymous one if the release lists
/// them straight under its heading.
fn section_of(release: &mut ChangelogRelease) -> &mut ChangelogSection {
    if release.sections.is_empty() {
        release.sections.push(ChangelogSection {
            title: String::new(),
            items: Vec::new(),
        });
    }

    release
        .sections
        .last_mut()
        .expect("a section was just pushed if there was none")
}

/// `- entry` or `* entry`, stripped of its marker. `None` for anything else —
/// a `-` alone included, which carries no entry.
fn bullet(line: &str) -> Option<&str> {
    line.strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
}

/// `[0.1.1] - 2026-08-27` → `("0.1.1", Some("2026-08-27"))`.
///
/// The separator is looked for **after** the version so a date is never taken
/// from a version that carries a dash itself (`1.0.0-rc.1`).
fn split_heading(heading: &str) -> (String, Option<String>) {
    let heading = heading.trim();
    let (version, rest) = match heading.strip_prefix('[') {
        Some(bracketed) => match bracketed.split_once(']') {
            Some((version, rest)) => (version, rest),
            None => (bracketed, ""),
        },
        None => match heading.split_once(" - ") {
            Some((version, rest)) => (version, rest),
            None => (heading, ""),
        },
    };

    let date = rest
        .trim()
        .trim_start_matches(['-', '–', '—'])
        .trim()
        .to_string();

    (
        version.trim().to_string(),
        (!date.is_empty()).then_some(date),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
# Changelog

Everything above the first release is preamble.

## [0.2.0] - 2026-09-11

### Added

- A todo list is a note too,
  and it wraps onto a second line.
- Sample notes on first launch.

### Fixed

- A crash nobody saw.

## 0.1.0

- Shipped at last.
";

    #[test]
    fn reads_a_release_with_its_date_and_categories() {
        let releases = parse(SAMPLE);

        assert_eq!(releases.len(), 2);
        assert_eq!(releases[0].version, "0.2.0");
        assert_eq!(releases[0].date.as_deref(), Some("2026-09-11"));
        assert_eq!(
            releases[0]
                .sections
                .iter()
                .map(|section| section.title.as_str())
                .collect::<Vec<_>>(),
            ["Added", "Fixed"]
        );
    }

    #[test]
    fn joins_a_wrapped_entry_rather_than_dropping_its_tail() {
        let releases = parse(SAMPLE);

        assert_eq!(
            releases[0].sections[0].items[0],
            "A todo list is a note too, and it wraps onto a second line."
        );
    }

    #[test]
    fn gives_an_anonymous_category_to_entries_listed_without_one() {
        // Without it those entries would have nowhere to go and would vanish.
        let releases = parse(SAMPLE);

        assert_eq!(releases[1].version, "0.1.0");
        assert_eq!(releases[1].date, None);
        assert_eq!(releases[1].sections.len(), 1);
        assert_eq!(releases[1].sections[0].title, "");
        assert_eq!(releases[1].sections[0].items, ["Shipped at last."]);
    }

    #[test]
    fn ignores_what_sits_above_the_first_release() {
        // A preamble entry adopted by a release would be read as a change.
        let releases = parse("# Changelog\n\n- Read me first.\n\n## 0.1.0\n\n- Shipped.\n");

        assert_eq!(releases.len(), 1);
        assert_eq!(releases[0].sections[0].items, ["Shipped."]);
    }

    #[test]
    fn keeps_a_dash_inside_a_version_out_of_the_date() {
        assert_eq!(
            split_heading("1.0.0-rc.1"),
            ("1.0.0-rc.1".to_string(), None)
        );
        assert_eq!(
            split_heading("[1.0.0-rc.1] - 2026-01-01"),
            ("1.0.0-rc.1".to_string(), Some("2026-01-01".to_string()))
        );
    }

    #[test]
    fn reads_a_heading_that_names_no_version_number() {
        let releases = parse("## Unreleased\n\n- Not out yet.\n");

        assert_eq!(releases[0].version, "Unreleased");
        assert_eq!(releases[0].date, None);
    }

    #[test]
    fn a_blank_line_closes_an_entry_rather_than_gluing_the_next_paragraph() {
        let releases = parse("## 0.1.0\n\n- Shipped.\n\nA loose paragraph.\n");

        assert_eq!(releases[0].sections[0].items, ["Shipped."]);
    }
}
