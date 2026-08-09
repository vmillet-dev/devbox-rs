//! Note de référence partagée par les tests de la feature : un champ ajouté à
//! [`Note`] se déclare ici plutôt que dans chaque module qui en construit une.

use chrono::{DateTime, Utc};

use super::language::Language;
use super::model::{Note, NoteLifecycle};
use crate::db::iso8601;

pub(crate) const NOW: &str = "2026-07-25T09:00:00.000Z";

pub(crate) fn at(iso: &str) -> DateTime<Utc> {
    iso8601::parse(iso).expect("les tests écrivent des instants valides")
}

pub(crate) fn note() -> Note {
    Note {
        id: "n-1".to_string(),
        space_id: "s-1".to_string(),
        title: "Titre".to_string(),
        language: Language::Txt,
        content: "Contenu".to_string(),
        source: String::new(),
        tags: vec!["auth".to_string()],
        pinned: false,
        created_at: at(NOW),
        updated_at: at(NOW),
        lifecycle: NoteLifecycle::Permanent,
    }
}
