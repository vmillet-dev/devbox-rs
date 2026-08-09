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
mod tests;
