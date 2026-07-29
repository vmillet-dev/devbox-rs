//! Devine le langage d'un contenu collé.
//!
//! Sans ça toute note naît en `txt` et le rail des formats ne sert qu'à ceux qui
//! pensent à renseigner le sélecteur — un rail vide de valeur.
//!
//! Les heuristiques sont volontairement bon marché et faillibles : le résultat
//! n'est qu'une **valeur initiale**, que l'éditeur laisse changer. Une erreur
//! coûte un clic.
//!
//! Deux points d'entrée, pour le même instant — celui où une note reçoit son
//! premier contenu : [`with_detected_language`] à la création (le raccourci de
//! capture, qui colle et crée d'un coup) et [`language_after_patch`] quand un
//! patch remplit une note encore vide (« + Nouvelle note » puis coller). Passé
//! ce moment, plus rien n'est deviné.

use super::note::{Note, NoteDraft, NotePatch};
use super::rules::FALLBACK_LANGUAGE;

/// Complète le langage d'un brouillon **uniquement** si le front n'en a pas
/// choisi, `txt` faisant office de « rien choisi ».
///
/// La règle vit ici et non dans la commande : appliquée aussi à `update_note`,
/// elle écraserait à la frappe suivante le langage posé au sélecteur.
pub fn with_detected_language(draft: NoteDraft) -> NoteDraft {
    if draft.language != FALLBACK_LANGUAGE {
        return draft;
    }

    NoteDraft {
        language: detect_language(&draft.content).to_string(),
        ..draft
    }
}

/// Langage à écrire quand un patch donne à une note son **premier** contenu,
/// `None` quand il n'y a rien à deviner.
///
/// C'est le geste ordinaire : « + Nouvelle note » crée une note vide, puis on
/// colle dans l'éditeur. La création ne voit alors aucun contenu, et sans cette
/// règle la note resterait en `txt` quoi qu'on y mette.
///
/// Trois refus, qui sont ce qui empêche la détection de devenir une correction
/// permanente :
/// - le patch pose lui-même un langage — l'utilisateur vient de choisir ;
/// - la note en portait déjà un autre que `txt` — un choix ne se corrige pas ;
/// - la note avait déjà du contenu — elle a son identité, et re-détecter à
///   chaque frappe reprendrait à l'utilisateur le sélecteur qu'on lui offre.
pub fn language_after_patch(before: &Note, patch: &NotePatch) -> Option<String> {
    if patch.language.is_some()
        || before.language != FALLBACK_LANGUAGE
        || !before.content.trim().is_empty()
    {
        return None;
    }

    let content = patch.content.as_ref()?;
    if content.trim().is_empty() {
        return None;
    }

    Some(detect_language(content).to_string())
}

/// Renvoie toujours une valeur de [`super::rules::LANGUAGES`].
///
/// L'ordre des essais va du signal le plus discriminant au plus vague : une
/// accolade ouvrante est un indice bien plus sûr qu'un `clé: valeur`.
pub fn detect_language(content: &str) -> &'static str {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return FALLBACK_LANGUAGE;
    }

    if trimmed.starts_with("#!") {
        return "sh";
    }
    if is_json(trimmed) {
        return "json";
    }

    let lower = trimmed.to_lowercase();
    if let Some(markup) = markup_kind(&lower) {
        return markup;
    }
    if is_sql(&lower) {
        return "sql";
    }
    if is_toml(trimmed) {
        return "toml";
    }
    if is_python(trimmed) {
        return "py";
    }
    if is_typescript(trimmed) {
        return "ts";
    }
    if is_javascript(trimmed) {
        return "js";
    }
    if is_css(trimmed) {
        return "css";
    }
    if is_yaml(trimmed) {
        return "yml";
    }
    if is_markdown(trimmed) {
        return "md";
    }
    if is_shell(trimmed) {
        return "sh";
    }

    FALLBACK_LANGUAGE
}

/// Lignes désindentées : toutes les règles raisonnent sur le début utile.
fn any_line(content: &str, predicate: impl Fn(&str) -> bool) -> bool {
    content.lines().map(str::trim).any(predicate)
}

fn starts_with_any(line: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| line.starts_with(prefix))
}

/// Le guillemet écarte un bloc de code dont l'accolade serait celle d'un corps
/// de fonction ; un tableau se reconnaît à ses crochets seuls.
fn is_json(content: &str) -> bool {
    let wrapped = (content.starts_with('{') && content.ends_with('}'))
        || (content.starts_with('[') && content.ends_with(']'));

    wrapped && (content.contains('"') || content.starts_with('['))
}

fn markup_kind(lower: &str) -> Option<&'static str> {
    if !lower.starts_with('<') {
        return None;
    }
    if lower.starts_with("<?xml") {
        return Some("xml");
    }
    if lower.starts_with("<!doctype html") || lower.starts_with("<html") {
        return Some("html");
    }

    const HTML_TAGS: [&str; 8] = [
        "<div", "<span", "<p>", "<body", "<head", "<a ", "<ul", "<table",
    ];
    if HTML_TAGS.iter().any(|tag| lower.contains(tag)) {
        Some("html")
    } else {
        Some("xml")
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
/// tableau posé sur sa propre ligne dans n'importe quel langage.
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

/// Un sélecteur suivi d'au moins une déclaration : l'accolade seule ne
/// distinguerait pas une feuille de style d'un corps de fonction.
fn is_css(content: &str) -> bool {
    if !content.contains('{') || !content.contains('}') {
        return false;
    }

    // Un `propriété: valeur;` où qu'il soit dans la ligne, et pas seulement en
    // fin : une règle compacte (`a { color: #000; }`) tient sur une seule.
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
    // Le point-virgule et l'accolade appartiennent aux langages déjà écartés
    // plus haut ; les revoir ici signifie qu'on s'est trompé de piste.
    if content.contains(';') || content.contains('{') {
        return false;
    }

    content.starts_with("---")
        || any_line(content, |line| line.starts_with("- ") || is_mapping(line))
}

/// `clé:` ou `clé: valeur`. L'espace exigé après le deux-points écarte une URL,
/// dont le `http://…` passerait sinon pour une clé.
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

/// Dernier recours : quelques commandes en tête de ligne. Volontairement pauvre,
/// une liste large attraperait de la prose.
fn is_shell(content: &str) -> bool {
    const COMMANDS: [&str; 10] = [
        "echo ", "cd ", "ls ", "cat ", "grep ", "sudo ", "npm ", "git ", "docker ", "curl ",
    ];

    any_line(content, |line| starts_with_any(line, &COMMANDS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::note::NoteLifecycle;
    use crate::domain::rules::LANGUAGES;

    fn draft(language: &str, content: &str) -> NoteDraft {
        NoteDraft {
            space_id: "s-1".to_string(),
            title: String::new(),
            language: language.to_string(),
            content: content.to_string(),
            source: String::new(),
            tags: Vec::new(),
            pinned: false,
            lifecycle: NoteLifecycle::Permanent,
        }
    }

    #[test]
    fn a_draft_with_no_chosen_language_gets_the_detected_one() {
        let filled = with_detected_language(draft("txt", "SELECT 1"));

        assert_eq!(filled.language, "sql");
    }

    #[test]
    fn a_chosen_language_is_never_overwritten() {
        // The editor's select is a decision; re-detecting on every write would
        // undo it the moment the content stops looking like that language.
        let filled = with_detected_language(draft("md", "SELECT 1"));

        assert_eq!(filled.language, "md");
    }

    #[test]
    fn an_empty_draft_stays_plain_text() {
        let filled = with_detected_language(draft("txt", ""));

        assert_eq!(filled.language, "txt");
    }

    fn blank_note() -> Note {
        Note {
            language: "txt".to_string(),
            content: String::new(),
            ..crate::domain::fixtures::note()
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
        let detected =
            language_after_patch(&blank_note(), &content_patch("interface A { id: string }"));

        assert_eq!(detected.as_deref(), Some("ts"));
    }

    #[test]
    fn a_note_that_already_had_content_keeps_its_language() {
        // It has an identity; re-detecting on every keystroke would take the
        // select back from the user.
        let note = Note {
            content: "du texte".to_string(),
            ..blank_note()
        };

        assert!(language_after_patch(&note, &content_patch("SELECT 1")).is_none());
    }

    #[test]
    fn a_chosen_language_is_never_corrected_by_a_later_paste() {
        let note = Note {
            language: "md".to_string(),
            ..blank_note()
        };

        assert!(language_after_patch(&note, &content_patch("SELECT 1")).is_none());
    }

    #[test]
    fn a_patch_setting_the_language_itself_is_left_alone() {
        // The user just picked from the select, in the same write.
        let patch = NotePatch {
            language: Some("md".to_string()),
            ..content_patch("SELECT 1")
        };

        assert!(language_after_patch(&blank_note(), &patch).is_none());
    }

    #[test]
    fn a_patch_carrying_no_content_detects_nothing() {
        let patch = NotePatch {
            title: Some("Titre".to_string()),
            ..NotePatch::default()
        };

        assert!(language_after_patch(&blank_note(), &patch).is_none());
    }

    #[test]
    fn clearing_the_content_does_not_detect() {
        assert!(language_after_patch(&blank_note(), &content_patch("   ")).is_none());
    }

    #[test]
    fn filling_the_language_leaves_the_rest_of_the_draft_alone() {
        let filled = with_detected_language(draft("txt", "{\"a\": 1}"));

        assert_eq!(filled.language, "json");
        assert_eq!(filled.content, "{\"a\": 1}");
        assert_eq!(filled.space_id, "s-1");
    }

    #[test]
    fn every_detected_language_is_one_the_editor_accepts() {
        // A value outside this list would be refused by `validate_language`, so
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
                LANGUAGES.contains(&detect_language(sample)),
                "sample: {sample}"
            );
        }
    }

    #[test]
    fn an_empty_or_blank_content_stays_plain_text() {
        assert_eq!(detect_language(""), "txt");
        assert_eq!(detect_language("   \n  "), "txt");
    }

    #[test]
    fn prose_stays_plain_text() {
        // The common case of a scratch note: it must not be dressed up as code.
        assert_eq!(
            detect_language("Penser à relancer Marc au sujet du certificat"),
            "txt"
        );
    }

    #[test]
    fn a_json_object_or_array_is_recognised() {
        assert_eq!(detect_language("{\n  \"id\": 42\n}"), "json");
        assert_eq!(detect_language("[1, 2, 3]"), "json");
        assert_eq!(detect_language("  {\"a\": [1]}  "), "json");
    }

    #[test]
    fn a_shebang_wins_over_everything_that_follows() {
        assert_eq!(detect_language("#!/usr/bin/env python\nimport os"), "sh");
    }

    #[test]
    fn markup_splits_between_html_and_xml() {
        assert_eq!(detect_language("<!DOCTYPE html>\n<html></html>"), "html");
        assert_eq!(detect_language("<div class=\"x\">hi</div>"), "html");
        assert_eq!(detect_language("<?xml version=\"1.0\"?>\n<root/>"), "xml");
        assert_eq!(detect_language("<config><item/></config>"), "xml");
    }

    #[test]
    fn sql_is_recognised_whatever_its_case() {
        assert_eq!(detect_language("SELECT * FROM notes"), "sql");
        assert_eq!(detect_language("select 1"), "sql");
        assert_eq!(
            detect_language("CREATE TABLE notes (id TEXT PRIMARY KEY)"),
            "sql"
        );
    }

    #[test]
    fn toml_needs_both_a_section_and_an_assignment() {
        assert_eq!(detect_language("[package]\nname = \"devbox\""), "toml");
        // A bare list on its own line is not a section header.
        assert_ne!(detect_language("[1, 2]\nx = 3"), "toml");
    }

    #[test]
    fn python_is_told_apart_from_typescript_by_its_colon() {
        assert_eq!(detect_language("def run():\n    return 1"), "py");
        assert_eq!(detect_language("class Note:\n    pass"), "py");
        assert_eq!(detect_language("from os import path"), "py");
        // Same keyword, brace instead of colon.
        assert_eq!(detect_language("class Note { }"), "js");
    }

    #[test]
    fn typescript_wins_over_javascript_on_its_own_markers() {
        assert_eq!(detect_language("interface Note { id: string }"), "ts");
        assert_eq!(detect_language("export type Id = string"), "ts");
        assert_eq!(detect_language("const a: number = 1"), "ts");
        // Nothing type-specific: plain JavaScript.
        assert_eq!(detect_language("const add = (a, b) => a + b"), "js");
        assert_eq!(detect_language("console.log('hi')"), "js");
    }

    #[test]
    fn css_needs_a_selector_and_a_declaration() {
        assert_eq!(detect_language(".card {\n  color: red;\n}"), "css");
        assert_eq!(
            detect_language("@media print {\n  a { color: #000; }\n}"),
            "css"
        );
    }

    #[test]
    fn yaml_is_recognised_by_its_mappings_and_lists() {
        assert_eq!(detect_language("name: devbox\nversion: 1"), "yml");
        assert_eq!(detect_language("---\nsteps:\n  - build"), "yml");
    }

    #[test]
    fn a_bare_url_is_not_read_as_a_yaml_mapping() {
        // "https://example.com" splits on ':' with a value that has no space;
        // without that rule every pasted link would come back as YAML.
        assert_ne!(detect_language("https://example.com/a/b"), "yml");
    }

    #[test]
    fn markdown_is_recognised_by_its_headings_and_fences() {
        assert_eq!(detect_language("# Titre\n\nUn paragraphe."), "md");
        assert_eq!(detect_language("Voir ```code``` ici"), "md");
        assert_eq!(detect_language("Un [lien](https://x.dev)"), "md");
    }

    #[test]
    fn shell_commands_are_the_last_resort() {
        assert_eq!(detect_language("git status\ngit push"), "sh");
        assert_eq!(detect_language("docker run -p 8080:80 nginx"), "sh");
    }
}
