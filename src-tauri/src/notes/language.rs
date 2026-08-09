//! Le langage d'une note : la liste reconnue, et la détection d'un contenu collé.
//!
//! Les heuristiques de détection sont volontairement bon marché et faillibles :
//! le résultat n'est qu'une **valeur initiale**, que l'éditeur laisse changer.
//! Une erreur coûte un clic. Elles ne jouent qu'au moment où une note reçoit son
//! premier contenu — [`for_draft`] à la création, [`after_patch`] au premier
//! collage. Passé ce moment, plus rien n'est deviné.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::model::{Note, NoteDraft, NotePatch};

/// Liste **fermée**, et c'est tout l'intérêt : le front la reçoit en union
/// TypeScript générée, donc une valeur inconnue ne compile plus chez lui au lieu
/// d'être refusée à l'exécution.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Json,
    Js,
    Ts,
    Py,
    Sql,
    Yml,
    Toml,
    Xml,
    Html,
    Css,
    Sh,
    Md,
    /// Défaut, et **signal que le front n'a rien choisi** : c'est lui que la
    /// création remplace par une détection.
    #[default]
    Txt,
}

impl Language {
    pub const ALL: [Self; 13] = [
        Self::Json,
        Self::Js,
        Self::Ts,
        Self::Py,
        Self::Sql,
        Self::Yml,
        Self::Toml,
        Self::Xml,
        Self::Html,
        Self::Css,
        Self::Sh,
        Self::Md,
        Self::Txt,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Js => "js",
            Self::Ts => "ts",
            Self::Py => "py",
            Self::Sql => "sql",
            Self::Yml => "yml",
            Self::Toml => "toml",
            Self::Xml => "xml",
            Self::Html => "html",
            Self::Css => "css",
            Self::Sh => "sh",
            Self::Md => "md",
            Self::Txt => "txt",
        }
    }
}

impl fmt::Display for Language {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// `notes.language` ne porte aucun `CHECK` (migration 3) : une base écrite par
/// une version plus récente peut contenir un langage inconnu d'ici.
impl FromStr for Language {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|language| language.as_str() == value)
            .ok_or(())
    }
}

/// Celui du front s'il en a choisi un, sinon une détection — `txt` faisant
/// office de « rien choisi ».
pub fn for_draft(draft: &NoteDraft) -> Language {
    if draft.language == Language::default() {
        from_content(&draft.content)
    } else {
        draft.language
    }
}

/// Le geste ordinaire : « + Nouvelle note » crée une note vide, puis on colle.
/// La création ne voyant aucun contenu, sans ça la note resterait en `txt`.
///
/// Les trois refus sont ce qui empêche la détection de devenir une correction
/// permanente : un langage posé au sélecteur, un langage déjà autre que `txt`,
/// ou une note qui avait déjà du contenu.
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

/// L'ordre des essais va du signal le plus discriminant au plus vague.
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

/// Le guillemet écarte un bloc de code dont l'accolade serait celle d'un corps
/// de fonction.
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

/// Une section **et** une affectation : `[…]` seul se confondrait avec un
/// tableau sur sa propre ligne dans n'importe quel langage.
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

/// `class` demande son deux-points final : sans lui c'est celui de TypeScript.
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

/// Un sélecteur **et** une déclaration : l'accolade seule ne distinguerait pas
/// une feuille de style d'un corps de fonction.
fn is_css(content: &str) -> bool {
    if !content.contains('{') || !content.contains('}') {
        return false;
    }

    // Où qu'il soit dans la ligne : une règle compacte tient sur une seule.
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
    // Ils appartiennent aux langages déjà écartés plus haut : les revoir ici
    // signifie qu'on s'est trompé de piste.
    if content.contains(';') || content.contains('{') {
        return false;
    }

    content.starts_with("---")
        || any_line(content, |line| line.starts_with("- ") || is_mapping(line))
}

/// L'espace exigé après le deux-points écarte une URL, dont le `http://…`
/// passerait sinon pour une clé.
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

/// Volontairement pauvre : une liste large attraperait de la prose.
fn is_shell(content: &str) -> bool {
    const COMMANDS: [&str; 10] = [
        "echo ", "cd ", "ls ", "cat ", "grep ", "sudo ", "npm ", "git ", "docker ", "curl ",
    ];

    any_line(content, |line| starts_with_any(line, &COMMANDS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::model::NoteLifecycle;

    #[test]
    fn every_variant_round_trips_through_its_stored_form() {
        for language in Language::ALL {
            assert_eq!(language.as_str().parse(), Ok(language));
        }
    }

    #[test]
    fn an_unknown_value_is_refused_rather_than_guessed() {
        // A database written by a newer binary can hold one; the caller decides
        // whether to fall back, and it does so in one place.
        assert_eq!("rust".parse::<Language>(), Err(()));
        assert_eq!("JSON".parse::<Language>(), Err(()));
    }

    #[test]
    fn the_default_is_the_one_detection_replaces() {
        assert_eq!(Language::default(), Language::Txt);
    }

    #[test]
    fn the_serialised_form_matches_the_stored_one() {
        // The bindings export this spelling as a TS union; the column holds the
        // same string. One vocabulary, two consumers.
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
        }
    }

    #[test]
    fn a_draft_with_no_chosen_language_gets_the_detected_one() {
        assert_eq!(for_draft(&draft(Language::Txt, "SELECT 1")), Language::Sql);
    }

    #[test]
    fn a_chosen_language_is_never_overwritten() {
        // The editor's select is a decision; re-detecting on every write would
        // undo it the moment the content stops looking like that language.
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
        // The ordinary gesture: "+ New note" creates an empty note, and the
        // paste lands through `update_note`. Without this the note would stay
        // `txt` whatever is put in it.
        let detected = after_patch(&blank_note(), &content_patch("interface A { id: string }"));

        assert_eq!(detected, Some(Language::Ts));
    }

    #[test]
    fn a_note_that_already_had_content_keeps_its_language() {
        // It has an identity; re-detecting on every keystroke would take the
        // select back from the user.
        let note = Note {
            content: "du texte".to_string(),
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
        // The user just picked from the select, in the same write.
        let patch = NotePatch {
            language: Some(Language::Md),
            ..content_patch("SELECT 1")
        };

        assert!(after_patch(&blank_note(), &patch).is_none());
    }

    #[test]
    fn a_patch_carrying_no_content_detects_nothing() {
        let patch = NotePatch {
            title: Some("Titre".to_string()),
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
        // A value outside this list would be refused by `language::validate`, so
        // detection would turn a paste into a failed creation.
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
            "juste du texte",
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
        // The common case of a scratch note: it must not be dressed up as code.
        assert_eq!(
            from_content("Penser à relancer Marc au sujet du certificat"),
            Language::Txt
        );
    }

    #[test]
    fn a_json_object_or_array_is_recognised() {
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
    fn sql_is_recognised_whatever_its_case() {
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
        // A bare list on its own line is not a section header.
        assert_ne!(from_content("[1, 2]\nx = 3"), Language::Toml);
    }

    #[test]
    fn python_is_told_apart_from_typescript_by_its_colon() {
        assert_eq!(from_content("def run():\n    return 1"), Language::Py);
        assert_eq!(from_content("class Note:\n    pass"), Language::Py);
        assert_eq!(from_content("from os import path"), Language::Py);
        // Same keyword, brace instead of colon.
        assert_eq!(from_content("class Note { }"), Language::Js);
    }

    #[test]
    fn typescript_wins_over_javascript_on_its_own_markers() {
        assert_eq!(from_content("interface Note { id: string }"), Language::Ts);
        assert_eq!(from_content("export type Id = string"), Language::Ts);
        assert_eq!(from_content("const a: number = 1"), Language::Ts);
        // Nothing type-specific: plain JavaScript.
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
    fn yaml_is_recognised_by_its_mappings_and_lists() {
        assert_eq!(from_content("name: devbox\nversion: 1"), Language::Yml);
        assert_eq!(from_content("---\nsteps:\n  - build"), Language::Yml);
    }

    #[test]
    fn a_bare_url_is_not_read_as_a_yaml_mapping() {
        // "https://example.com" splits on ':' with a value that has no space;
        // without that rule every pasted link would come back as YAML.
        assert_ne!(from_content("https://example.com/a/b"), Language::Yml);
    }

    #[test]
    fn markdown_is_recognised_by_its_headings_and_fences() {
        assert_eq!(from_content("# Titre\n\nUn paragraphe."), Language::Md);
        assert_eq!(from_content("Voir ```code``` ici"), Language::Md);
        assert_eq!(from_content("Un [lien](https://x.dev)"), Language::Md);
    }

    #[test]
    fn shell_commands_are_the_last_resort() {
        assert_eq!(from_content("git status\ngit push"), Language::Sh);
        assert_eq!(from_content("docker run -p 8080:80 nginx"), Language::Sh);
    }
}
