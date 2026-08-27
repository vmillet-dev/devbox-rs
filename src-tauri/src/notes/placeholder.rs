//! Champs à remplir dans un snippet : `{{host}}`, `{{port=5432}}`.
//!
//! Le nom est volontairement restreint à `[A-Za-z0-9_-]` : une note contenant
//! du template Angular (`{{ user.name }}`) ou du Handlebars ne doit pas se
//! transformer en formulaire à chaque copie.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

const OPEN: &str = "{{";
const CLOSE: &str = "}}";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Placeholder {
    pub name: String,
    /// Vide quand le snippet n'en propose pas.
    pub default_value: String,
}

fn parse_token(inner: &str) -> Option<Placeholder> {
    let (name, default_value) = match inner.split_once('=') {
        Some((name, value)) => (name.trim(), value.trim()),
        None => (inner.trim(), ""),
    };

    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }

    Some(Placeholder {
        name: name.to_string(),
        default_value: default_value.to_string(),
    })
}

/// Chaque `{{…}}` reconnu, dans l'ordre d'apparition et sans doublon : c'est
/// l'ordre du formulaire de saisie.
fn scan(content: &str, mut on_token: impl FnMut(&str, Option<Placeholder>)) {
    let mut rest = content;

    while let Some(start) = rest.find(OPEN) {
        let after_open = &rest[start + OPEN.len()..];
        let Some(end) = after_open.find(CLOSE) else {
            break;
        };

        let inner = &after_open[..end];
        on_token(inner, parse_token(inner));
        rest = &after_open[end + CLOSE.len()..];
    }
}

pub fn parse(content: &str) -> Vec<Placeholder> {
    let mut found: Vec<Placeholder> = Vec::new();

    scan(content, |_, placeholder| {
        if let Some(placeholder) = placeholder
            && !found.iter().any(|seen| seen.name == placeholder.name)
        {
            found.push(placeholder);
        }
    });

    found
}

/// Remplace chaque jeton par la valeur fournie, à défaut par sa valeur par
/// défaut. Un jeton non reconnu est **laissé tel quel** : il fait partie du
/// texte, pas du formulaire.
pub fn fill(content: &str, values: &BTreeMap<String, String>) -> String {
    let mut filled = String::with_capacity(content.len());
    let mut rest = content;

    while let Some(start) = rest.find(OPEN) {
        let after_open = &rest[start + OPEN.len()..];
        let Some(end) = after_open.find(CLOSE) else {
            break;
        };

        filled.push_str(&rest[..start]);
        let inner = &after_open[..end];

        if let Some(placeholder) = parse_token(inner) {
            filled.push_str(
                values
                    .get(&placeholder.name)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(&placeholder.default_value),
            );
        } else {
            filled.push_str(OPEN);
            filled.push_str(inner);
            filled.push_str(CLOSE);
        }

        rest = &after_open[end + CLOSE.len()..];
    }

    filled.push_str(rest);
    filled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    fn names(content: &str) -> Vec<String> {
        parse(content)
            .into_iter()
            .map(|placeholder| placeholder.name)
            .collect()
    }

    #[test]
    fn each_field_is_listed_once_in_order_of_appearance() {
        assert_eq!(
            names("psql -h {{host}} -p {{port}} -d {{db}} # {{host}}"),
            ["host", "port", "db"]
        );
    }

    #[test]
    fn a_default_value_is_read_after_the_equals_sign() {
        assert_eq!(
            parse("{{ port = 5432 }}"),
            [Placeholder {
                name: "port".to_string(),
                default_value: "5432".to_string(),
            }]
        );
    }

    #[test]
    fn a_template_expression_is_not_a_field() {
        // Le cas qui compte : une note de code Angular ne doit pas réclamer un
        // formulaire à chaque copie.
        assert!(names("<p>{{ user.name }}</p> {{ items[0] }}").is_empty());
    }

    #[test]
    fn an_unterminated_token_ends_the_scan_without_panicking() {
        assert_eq!(names("{{host}} puis {{oops"), ["host"]);
    }

    #[test]
    fn filling_substitutes_every_occurrence() {
        assert_eq!(
            fill(
                "{{host}}:{{port}}/{{host}}",
                &values(&[("host", "db"), ("port", "5432")])
            ),
            "db:5432/db"
        );
    }

    #[test]
    fn a_missing_value_falls_back_to_the_default() {
        assert_eq!(fill("{{port=5432}}", &BTreeMap::new()), "5432");
    }

    #[test]
    fn an_empty_value_falls_back_to_the_default_too() {
        // Le formulaire envoie tous ses champs : un champ laissé vide vaut
        // « je garde ce que le snippet propose ».
        assert_eq!(fill("{{port=5432}}", &values(&[("port", "")])), "5432");
    }

    #[test]
    fn a_field_without_value_nor_default_disappears() {
        assert_eq!(fill("a{{x}}b", &BTreeMap::new()), "ab");
    }

    #[test]
    fn what_is_not_a_field_survives_untouched() {
        let template = "<p>{{ user.name }}</p>";

        assert_eq!(fill(template, &values(&[("user", "x")])), template);
    }
}
