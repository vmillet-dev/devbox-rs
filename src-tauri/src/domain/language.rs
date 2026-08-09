//! Le langage d'une note : la liste reconnue, et la détection d'un contenu collé.

pub mod detect;

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use specta::Type;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
