use crate::closed_enum::closed_enum;

use super::model::{Note, NoteDraft, NotePatch};

closed_enum! {
    /// **Closed**: the front end receives it as a generated TypeScript union, so
    /// an unknown value stops compiling there instead of being refused at runtime.
    pub enum Language {
        Json = "json",
        Js = "js",
        Ts = "ts",
        Py = "py",
        Sql = "sql",
        Yml = "yml",
        Toml = "toml",
        Xml = "xml",
        Html = "html",
        Css = "css",
        Sh = "sh",
        Md = "md",
        /// Default, and the signal that the front end chose nothing.
        #[default]
        Txt = "txt",
    }
}

/// The front end's choice if it made one, `txt` meaning it made none.
pub fn for_draft(draft: &NoteDraft) -> Language {
    if draft.language == Language::default() {
        from_content(&draft.content)
    } else {
        draft.language
    }
}

/// "+ New note" creates an empty note, then we paste: creation sees no content,
/// so without this the note would stay in `txt`. The three refusals are what keep
/// detection from becoming a permanent correction.
pub fn after_patch(before: &Note, patch: &NotePatch) -> Option<Language> {
    if patch.language.is_some()
        || before.language != Language::default()
        || !before.content.trim().is_empty()
    {
        return None;
    }

    let content = patch.content.as_ref()?;
    if content.trim().is_empty() {
        return None;
    }

    Some(from_content(content))
}

/// The order of attempts runs from the most discriminating signal to the vaguest.
pub fn from_content(content: &str) -> Language {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Language::default();
    }

    if trimmed.starts_with("#!") {
        return Language::Sh;
    }
    if is_json(trimmed) {
        return Language::Json;
    }

    let lower = trimmed.to_lowercase();
    if let Some(markup) = markup_kind(&lower) {
        return markup;
    }
    if is_sql(&lower) {
        return Language::Sql;
    }
    if is_toml(trimmed) {
        return Language::Toml;
    }
    if is_python(trimmed) {
        return Language::Py;
    }
    if is_typescript(trimmed) {
        return Language::Ts;
    }
    if is_javascript(trimmed) {
        return Language::Js;
    }
    if is_css(trimmed) {
        return Language::Css;
    }
    if is_yaml(trimmed) {
        return Language::Yml;
    }
    if is_markdown(trimmed) {
        return Language::Md;
    }
    if is_shell(trimmed) {
        return Language::Sh;
    }

    Language::default()
}

fn any_line(content: &str, predicate: impl Fn(&str) -> bool) -> bool {
    content.lines().map(str::trim).any(predicate)
}

fn starts_with_any(line: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| line.starts_with(prefix))
}

/// The quote rules out a code block whose brace is a function body's.
fn is_json(content: &str) -> bool {
    let wrapped = (content.starts_with('{') && content.ends_with('}'))
        || (content.starts_with('[') && content.ends_with(']'));

    wrapped && (content.contains('"') || content.starts_with('['))
}

fn markup_kind(lower: &str) -> Option<Language> {
    const HTML_TAGS: [&str; 8] = [
        "<div", "<span", "<p>", "<body", "<head", "<a ", "<ul", "<table",
    ];

    if !lower.starts_with('<') {
        return None;
    }
    if lower.starts_with("<?xml") {
        return Some(Language::Xml);
    }
    if lower.starts_with("<!doctype html") || lower.starts_with("<html") {
        return Some(Language::Html);
    }

    if HTML_TAGS.iter().any(|tag| lower.contains(tag)) {
        Some(Language::Html)
    } else {
        Some(Language::Xml)
    }
}

fn is_sql(lower: &str) -> bool {
    const STATEMENTS: [&str; 8] = [
        "select ",
        "insert into",
        "update ",
        "delete from",
        "create table",
        "alter table",
        "drop table",
        "with ",
    ];

    starts_with_any(lower, &STATEMENTS)
}

/// A section **and** an assignment: `[…]` alone could be an array on its own line.
fn is_toml(content: &str) -> bool {
    any_line(content, is_toml_section) && any_line(content, is_assignment)
}

fn is_toml_section(line: &str) -> bool {
    let Some(inner) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) else {
        return false;
    };
    let inner = inner.trim_matches(|c| c == '[' || c == ']');

    !inner.is_empty() && inner.chars().all(is_identifier_char)
}

fn is_assignment(line: &str) -> bool {
    line.split_once('=').is_some_and(|(key, _)| {
        let key = key.trim();
        !key.is_empty() && !key.contains(char::is_whitespace)
    })
}

fn is_identifier_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '.')
}

/// `class` needs its trailing colon: without it, this is TypeScript's.
fn is_python(content: &str) -> bool {
    content.contains("__name__")
        || any_line(content, |line| {
            starts_with_any(line, &["def ", "async def ", "elif "])
                || (line.starts_with("class ") && line.ends_with(':'))
                || (line.starts_with("from ") && line.contains(" import "))
        })
}

fn is_typescript(content: &str) -> bool {
    const ANNOTATIONS: [&str; 4] = [": string", ": number", ": boolean", "implements "];
    const DECLARATIONS: [&str; 4] = ["interface ", "type ", "enum ", "declare "];

    ANNOTATIONS.iter().any(|marker| content.contains(marker))
        || any_line(content, |line| {
            let line = line.strip_prefix("export ").unwrap_or(line);
            starts_with_any(line, &DECLARATIONS)
        })
}

fn is_javascript(content: &str) -> bool {
    const KEYWORDS: [&str; 7] = [
        "function ",
        "const ",
        "let ",
        "var ",
        "export ",
        "import ",
        "class ",
    ];

    content.contains("=>")
        || content.contains("console.log")
        || content.contains("require(")
        || any_line(content, |line| starts_with_any(line, &KEYWORDS))
}

/// A selector **and** a declaration: the brace alone would not tell a
/// stylesheet from a function body.
fn is_css(content: &str) -> bool {
    if !content.contains('{') || !content.contains('}') {
        return false;
    }

    let has_declaration = any_line(content, |line| {
        line.find(':')
            .zip(line.find(';'))
            .is_some_and(|(colon, semicolon)| colon < semicolon)
    });
    let has_selector = any_line(content, |line| {
        line.ends_with('{')
            && line.chars().next().is_some_and(|c| {
                c.is_ascii_alphabetic() || matches!(c, '.' | '#' | '@' | ':' | '*')
            })
    });

    has_declaration && has_selector
}

fn is_yaml(content: &str) -> bool {
    // These belong to languages already ruled out above.
    if content.contains(';') || content.contains('{') {
        return false;
    }

    content.starts_with("---")
        || any_line(content, |line| line.starts_with("- ") || is_mapping(line))
}

/// The space required after the colon rules out a URL, whose `http://…` would
/// otherwise read as a key.
fn is_mapping(line: &str) -> bool {
    let Some((key, value)) = line.split_once(':') else {
        return false;
    };

    !key.is_empty()
        && key.chars().all(is_identifier_char)
        && (value.is_empty() || value.starts_with(' '))
}

fn is_markdown(content: &str) -> bool {
    const LINE_MARKERS: [&str; 5] = ["# ", "## ", "### ", "* ", "> "];

    content.contains("```")
        || content.contains("](")
        || any_line(content, |line| starts_with_any(line, &LINE_MARKERS))
}

/// Deliberately thin: a wide list would catch prose.
fn is_shell(content: &str) -> bool {
    const COMMANDS: [&str; 10] = [
        "echo ", "cd ", "ls ", "cat ", "grep ", "sudo ", "npm ", "git ", "docker ", "curl ",
    ];

    any_line(content, |line| starts_with_any(line, &COMMANDS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::checklist::NoteKind;
    use crate::notes::model::NoteLifecycle;

    #[test]
    fn every_variant_round_trips_through_its_stored_form() {
        for language in Language::ALL {
            assert_eq!(language.as_str().parse(), Ok(language));
        }
    }

    #[test]
    fn an_unknown_value_is_refused_rather_than_guessed() {
        assert_eq!("rust".parse::<Language>(), Err(()));
        assert_eq!("JSON".parse::<Language>(), Err(()));
    }

    #[test]
    fn the_default_is_the_one_detection_replaces() {
        assert_eq!(Language::default(), Language::Txt);
    }

    #[test]
    fn the_serialized_form_matches_the_stored_one() {
        for language in Language::ALL {
            let json = serde_json::to_value(language).unwrap();
            assert_eq!(json, serde_json::json!(language.as_str()));
        }
    }

    fn draft(language: Language, content: &str) -> NoteDraft {
        NoteDraft {
            space_id: "s-1".to_string(),
            title: String::new(),
            language,
            content: content.to_string(),
            source: String::new(),
            tags: Vec::new(),
            pinned: false,
            lifecycle: NoteLifecycle::Permanent,
            kind: NoteKind::Snippet,
            items: Vec::new(),
        }
    }

    #[test]
    fn a_draft_with_no_chosen_language_gets_the_detected_one() {
        assert_eq!(for_draft(&draft(Language::Txt, "SELECT 1")), Language::Sql);
    }

    #[test]
    fn a_chosen_language_is_never_overwritten() {
        assert_eq!(for_draft(&draft(Language::Md, "SELECT 1")), Language::Md);
    }

    #[test]
    fn an_empty_draft_stays_plain_text() {
        assert_eq!(for_draft(&draft(Language::Txt, "")), Language::Txt);
    }

    fn blank_note() -> Note {
        Note {
            language: Language::Txt,
            content: String::new(),
            ..crate::notes::fixtures::note()
        }
    }

    fn content_patch(content: &str) -> NotePatch {
        NotePatch {
            content: Some(content.to_string()),
            ..NotePatch::default()
        }
    }

    #[test]
    fn an_empty_note_receiving_its_first_content_gets_a_language() {
        let detected = after_patch(&blank_note(), &content_patch("interface A { id: string }"));

        assert_eq!(detected, Some(Language::Ts));
    }

    #[test]
    fn a_note_that_already_had_content_keeps_its_language() {
        let note = Note {
            content: "some prose".to_string(),
            ..blank_note()
        };

        assert!(after_patch(&note, &content_patch("SELECT 1")).is_none());
    }

    #[test]
    fn a_chosen_language_is_never_corrected_by_a_later_paste() {
        let note = Note {
            language: Language::Md,
            ..blank_note()
        };

        assert!(after_patch(&note, &content_patch("SELECT 1")).is_none());
    }

    #[test]
    fn a_patch_setting_the_language_itself_is_left_alone() {
        let patch = NotePatch {
            language: Some(Language::Md),
            ..content_patch("SELECT 1")
        };

        assert!(after_patch(&blank_note(), &patch).is_none());
    }

    #[test]
    fn a_patch_carrying_no_content_detects_nothing() {
        let patch = NotePatch {
            title: Some("Title".to_string()),
            ..NotePatch::default()
        };

        assert!(after_patch(&blank_note(), &patch).is_none());
    }

    #[test]
    fn clearing_the_content_does_not_detect() {
        assert!(after_patch(&blank_note(), &content_patch("   ")).is_none());
    }

    #[test]
    fn every_detected_language_is_one_the_editor_accepts() {
        let samples = [
            "",
            "#!/bin/bash\necho hi",
            "{\"a\": 1}",
            "<?xml version=\"1.0\"?><a/>",
            "<html><body>hi</body></html>",
            "SELECT 1",
            "[package]\nname = \"x\"",
            "def f():\n    pass",
            "interface A { }",
            "const a = 1",
            ".a { color: red; }",
            "key: value",
            "# Title\n\n- item",
            "git status",
            "just some prose",
        ];

        for sample in samples {
            assert!(
                Language::ALL.contains(&from_content(sample)),
                "sample: {sample}"
            );
        }
    }

    #[test]
    fn an_empty_or_blank_content_stays_plain_text() {
        assert_eq!(from_content(""), Language::Txt);
        assert_eq!(from_content("   \n  "), Language::Txt);
    }

    #[test]
    fn prose_stays_plain_text() {
        assert_eq!(
            from_content("Penser à relancer Marc au sujet du certificat"),
            Language::Txt
        );
    }

    #[test]
    fn a_json_object_or_array_is_recognized() {
        assert_eq!(from_content("{\n  \"id\": 42\n}"), Language::Json);
        assert_eq!(from_content("[1, 2, 3]"), Language::Json);
        assert_eq!(from_content("  {\"a\": [1]}  "), Language::Json);
    }

    #[test]
    fn a_shebang_wins_over_everything_that_follows() {
        assert_eq!(
            from_content("#!/usr/bin/env python\nimport os"),
            Language::Sh
        );
    }

    #[test]
    fn markup_splits_between_html_and_xml() {
        assert_eq!(
            from_content("<!DOCTYPE html>\n<html></html>"),
            Language::Html
        );
        assert_eq!(from_content("<div class=\"x\">hi</div>"), Language::Html);
        assert_eq!(
            from_content("<?xml version=\"1.0\"?>\n<root/>"),
            Language::Xml
        );
        assert_eq!(from_content("<config><item/></config>"), Language::Xml);
    }

    #[test]
    fn sql_is_recognized_whatever_its_case() {
        assert_eq!(from_content("SELECT * FROM notes"), Language::Sql);
        assert_eq!(from_content("select 1"), Language::Sql);
        assert_eq!(
            from_content("CREATE TABLE notes (id TEXT PRIMARY KEY)"),
            Language::Sql
        );
    }

    #[test]
    fn toml_needs_both_a_section_and_an_assignment() {
        assert_eq!(from_content("[package]\nname = \"devbox\""), Language::Toml);
        assert_ne!(from_content("[1, 2]\nx = 3"), Language::Toml);
    }

    #[test]
    fn python_is_told_apart_from_typescript_by_its_colon() {
        assert_eq!(from_content("def run():\n    return 1"), Language::Py);
        assert_eq!(from_content("class Note:\n    pass"), Language::Py);
        assert_eq!(from_content("from os import path"), Language::Py);
        assert_eq!(from_content("class Note { }"), Language::Js);
    }

    #[test]
    fn typescript_wins_over_javascript_on_its_own_markers() {
        assert_eq!(from_content("interface Note { id: string }"), Language::Ts);
        assert_eq!(from_content("export type Id = string"), Language::Ts);
        assert_eq!(from_content("const a: number = 1"), Language::Ts);
        assert_eq!(from_content("const add = (a, b) => a + b"), Language::Js);
        assert_eq!(from_content("console.log('hi')"), Language::Js);
    }

    #[test]
    fn css_needs_a_selector_and_a_declaration() {
        assert_eq!(from_content(".card {\n  color: red;\n}"), Language::Css);
        assert_eq!(
            from_content("@media print {\n  a { color: #000; }\n}"),
            Language::Css
        );
    }

    #[test]
    fn yaml_is_recognized_by_its_mappings_and_lists() {
        assert_eq!(from_content("name: devbox\nversion: 1"), Language::Yml);
        assert_eq!(from_content("---\nsteps:\n  - build"), Language::Yml);
    }

    #[test]
    fn a_bare_url_is_not_read_as_a_yaml_mapping() {
        assert_ne!(from_content("https://example.com/a/b"), Language::Yml);
    }

    #[test]
    fn markdown_is_recognized_by_its_headings_and_fences() {
        assert_eq!(from_content("# Heading\n\nA paragraph."), Language::Md);
        assert_eq!(from_content("Voir ```code``` ici"), Language::Md);
        assert_eq!(from_content("Un [lien](https://x.dev)"), Language::Md);
    }

    #[test]
    fn shell_commands_are_the_last_resort() {
        assert_eq!(from_content("git status\ngit push"), Language::Sh);
        assert_eq!(from_content("docker run -p 8080:80 nginx"), Language::Sh);
    }
}
