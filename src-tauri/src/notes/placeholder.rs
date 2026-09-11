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
    /// Ce que l'utilisateur a déjà saisi pour ce champ, vide s'il n'a rien
    /// saisi. Rapporté ici plutôt que laissé dans la carte des valeurs pour
    /// qu'une seule liste réponde à « quels champs, et où en sont-ils » — et
    /// pour qu'une valeur devenue orpheline (le jeton a été renommé dans le
    /// texte) reste hors de vue sans être effacée.
    pub value: String,
}

/// Un nom de champ, et rien d'autre : c'est cette restriction qui empêche
/// `{{ user.name }}` de réclamer un formulaire.
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

/// Les champs du texte, munis de ce qui a déjà été saisi pour eux.
///
/// C'est le **texte** qui dit quels champs existent, jamais la carte des
/// valeurs : une valeur dont le jeton a disparu du contenu n'est pas un champ,
/// elle attend simplement qu'il revienne.
pub fn parse(content: &str, values: &BTreeMap<String, String>) -> Vec<Placeholder> {
    let mut found: Vec<Placeholder> = Vec::new();

    scan(content, |_, placeholder| {
        if let Some(mut placeholder) = placeholder
            && !found.iter().any(|seen| seen.name == placeholder.name)
        {
            placeholder.value = values.get(&placeholder.name).cloned().unwrap_or_default();
            found.push(placeholder);
        }
    });

    found
}

/// Ce qui mérite d'être écrit en base.
///
/// Une valeur vide est retirée plutôt que stockée : vide veut dire « je garde ce
/// que le snippet propose », et la ligne figerait cette réponse le jour où la
/// valeur par défaut du texte change. Un nom qui n'en est pas un ne peut
/// désigner aucun jeton — l'écrire ne ferait que du remplissage mort.
pub fn normalize_values(values: BTreeMap<String, String>) -> BTreeMap<String, String> {
    values
        .into_iter()
        .filter(|(name, value)| is_field_name(name) && !value.is_empty())
        .collect()
}

/// Ce qui remplit réellement les jetons : ce qui a été saisi sur la note
/// d'abord, la **variable globale** ensuite.
///
/// Une saisie vide n'écrase pas la variable — vide veut dire « je garde ce
/// qu'on me propose », exactement comme face à une valeur par défaut écrite
/// dans le texte. Et c'est la variable qui passe devant cette dernière : elle a
/// été réglée pour cette machine, là où `{{host=localhost}}` n'était qu'une
/// suggestion notée le jour où le snippet a été écrit.
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
        // Le jeton a été renommé dans le corps : la valeur reste en base — elle
        // revient si le renommage était une faute de frappe — mais le panneau
        // n'a aucune raison de proposer un champ que le texte ne porte plus.
        let fields = parse("{{hostname}}", &values(&[("host", "db")]));

        assert_eq!(names("{{hostname}}"), ["hostname"]);
        assert!(fields[0].value.is_empty());
    }

    #[test]
    fn only_what_can_designate_a_token_is_kept_for_writing() {
        assert_eq!(
            normalize_values(values(&[
                ("host", "db.internal"),
                // Vide = « je garde ce que le snippet propose » : l'écrire
                // figerait cette réponse.
                ("port", ""),
                ("user.name", "x"),
            ])),
            values(&[("host", "db.internal")])
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
        // Vide = « je garde ce qu'on me propose » : sans ce filtre, ouvrir le
        // panneau sans rien taper effacerait la variable à la copie suivante.
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
