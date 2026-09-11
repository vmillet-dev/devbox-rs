//! Fields to fill in a snippet: `{{host}}`, `{{port=5432}}`.
//!
//! ⚠️ The name is restricted to `[A-Za-z0-9_-]` on purpose: without it a note
//! holding Angular template code (`{{ user.name }}`) would demand a form on
//! every copy.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

const OPEN: &str = "{{";
const CLOSE: &str = "}}";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Placeholder {
    pub name: String,
    /// Empty when the snippet offers none.
    pub default_value: String,
    /// What has already been typed for this field, empty otherwise.
    ///
    /// Reported here rather than left in the value map so that one list answers
    /// "which fields, and where are they up to" — and so a value gone orphan
    /// (its token was renamed in the text) stays out of sight without being
    /// erased.
    pub value: String,
}

/// A field name, and nothing else: this restriction is what keeps
/// `{{ user.name }}` from demanding a form.
fn is_field_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn parse_token(inner: &str) -> Option<Placeholder> {
    let (name, default_value) = match inner.split_once('=') {
        Some((name, value)) => (name.trim(), value.trim()),
        None => (inner.trim(), ""),
    };

    if !is_field_name(name) {
        return None;
    }

    Some(Placeholder {
        name: name.to_string(),
        default_value: default_value.to_string(),
        value: String::new(),
    })
}

/// A piece of the text, as [`scan`] walks past it.
enum Fragment<'a> {
    Literal(&'a str),
    Token {
        /// Between the braces, as written.
        inner: &'a str,
        /// `None` when it is not a field: part of the text, not of the form.
        placeholder: Option<Placeholder>,
    },
}

/// Walks the text once, handing back every literal run and every `{{…}}` in
/// order.
///
/// The single walk is the point: [`parse`] and [`fill`] would otherwise each
/// carry their own idea of where a token starts and ends, and could drift.
///
/// An unterminated `{{` ends the walk, and the remainder — braces included —
/// comes back as one last literal.
fn scan(content: &str, mut on_fragment: impl FnMut(Fragment<'_>)) {
    let mut rest = content;

    while let Some(start) = rest.find(OPEN) {
        let after_open = &rest[start + OPEN.len()..];
        let Some(end) = after_open.find(CLOSE) else {
            break;
        };

        on_fragment(Fragment::Literal(&rest[..start]));

        let inner = &after_open[..end];
        on_fragment(Fragment::Token {
            inner,
            placeholder: parse_token(inner),
        });

        rest = &after_open[end + CLOSE.len()..];
    }

    on_fragment(Fragment::Literal(rest));
}

/// The fields of the text, carrying what has already been typed for them, in
/// order of appearance and without duplicates.
///
/// The **text** says which fields exist, never the value map: a value whose
/// token has left the content is not a field, it is simply waiting for it back.
pub fn parse(content: &str, values: &BTreeMap<String, String>) -> Vec<Placeholder> {
    let mut found: Vec<Placeholder> = Vec::new();

    scan(content, |fragment| {
        let Fragment::Token {
            placeholder: Some(mut placeholder),
            ..
        } = fragment
        else {
            return;
        };

        if found.iter().any(|seen| seen.name == placeholder.name) {
            return;
        }

        placeholder.value = values.get(&placeholder.name).cloned().unwrap_or_default();
        found.push(placeholder);
    });

    found
}

/// What deserves to be written to the database.
///
/// An empty value is dropped rather than stored: empty means "I keep what the
/// snippet offers", and the row would freeze that answer the day the default
/// written in the text changes. A name that is not one can designate no token.
pub fn normalize_values(values: BTreeMap<String, String>) -> BTreeMap<String, String> {
    values
        .into_iter()
        .filter(|(name, value)| is_field_name(name) && !value.is_empty())
        .collect()
}

/// What actually fills the tokens: what was typed on the note first, the
/// **global variable** next.
///
/// An empty entry does not overwrite the variable — empty means "I keep what I
/// am offered", exactly as against a default written in the text. And the
/// variable comes ahead of that default: it was set for this machine, where
/// `{{host=localhost}}` was only a suggestion noted the day the snippet was
/// written.
pub fn resolve(
    globals: &BTreeMap<String, String>,
    values: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut resolved = globals.clone();

    for (name, value) in values {
        if !value.is_empty() {
            resolved.insert(name.clone(), value.clone());
        }
    }

    resolved
}

/// Replaces each token by the value supplied, failing that by its default. A
/// token that is not a field is **left as it is**.
pub fn fill(content: &str, values: &BTreeMap<String, String>) -> String {
    let mut filled = String::with_capacity(content.len());

    scan(content, |fragment| match fragment {
        Fragment::Literal(text) => filled.push_str(text),
        Fragment::Token {
            placeholder: Some(placeholder),
            ..
        } => filled.push_str(
            values
                .get(&placeholder.name)
                .filter(|value| !value.is_empty())
                .unwrap_or(&placeholder.default_value),
        ),
        Fragment::Token {
            inner,
            placeholder: None,
        } => {
            filled.push_str(OPEN);
            filled.push_str(inner);
            filled.push_str(CLOSE);
        }
    });

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
        parse(content, &BTreeMap::new())
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
            parse("{{ port = 5432 }}", &BTreeMap::new()),
            [Placeholder {
                name: "port".to_string(),
                default_value: "5432".to_string(),
                value: String::new(),
            }]
        );
    }

    #[test]
    fn a_field_carries_what_was_already_typed_for_it() {
        assert_eq!(
            parse("{{host}}", &values(&[("host", "db.internal")])),
            [Placeholder {
                name: "host".to_string(),
                default_value: String::new(),
                value: "db.internal".to_string(),
            }]
        );
    }

    #[test]
    fn a_value_whose_token_left_the_text_is_not_a_field() {
        // The token was renamed in the body: the value stays in the database —
        // it comes back if the rename was a typo — but the panel has no reason
        // to offer a field the text no longer carries.
        let fields = parse("{{hostname}}", &values(&[("host", "db")]));

        assert_eq!(names("{{hostname}}"), ["hostname"]);
        assert!(fields[0].value.is_empty());
    }

    #[test]
    fn only_what_can_designate_a_token_is_kept_for_writing() {
        assert_eq!(
            normalize_values(values(&[
                ("host", "db.internal"),
                // Empty means "I keep what the snippet offers": writing it would
                // freeze that answer.
                ("port", ""),
                ("user.name", "x"),
            ])),
            values(&[("host", "db.internal")])
        );
    }

    #[test]
    fn a_template_expression_is_not_a_field() {
        // The case that matters: a note of Angular code must not demand a form
        // on every copy.
        assert!(names("<p>{{ user.name }}</p> {{ items[0] }}").is_empty());
    }

    #[test]
    fn an_unterminated_token_ends_the_scan_without_panicking() {
        assert_eq!(names("{{host}} puis {{oops"), ["host"]);
    }

    #[test]
    fn a_global_variable_fills_a_field_the_note_says_nothing_about() {
        let globals = values(&[("host", "db.internal")]);

        assert_eq!(
            fill("{{host}}", &resolve(&globals, &BTreeMap::new())),
            "db.internal"
        );
    }

    #[test]
    fn what_was_typed_on_the_note_wins_over_the_global_variable() {
        let globals = values(&[("host", "db.internal")]);

        assert_eq!(
            fill(
                "{{host}}",
                &resolve(&globals, &values(&[("host", "localhost")]))
            ),
            "localhost"
        );
    }

    #[test]
    fn an_empty_entry_leaves_the_global_variable_in_place() {
        // Empty means "I keep what I am offered": without this filter, opening
        // the panel without typing would erase the variable on the next copy.
        let globals = values(&[("host", "db.internal")]);

        assert_eq!(
            fill("{{host}}", &resolve(&globals, &values(&[("host", "")]))),
            "db.internal"
        );
    }

    #[test]
    fn a_global_variable_wins_over_the_default_written_in_the_text() {
        let globals = values(&[("port", "6543")]);

        assert_eq!(
            fill("{{port=5432}}", &resolve(&globals, &BTreeMap::new())),
            "6543"
        );
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
        // The form sends every field: one left empty means "I keep what the
        // snippet offers".
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
