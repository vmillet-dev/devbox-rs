//! La note : ce qui est persisté ([`Note`]) et ce qui est affiché ([`DisplayNote`]).
//!
//! ⚠️ `rename_all` et `tag = "kind"` sont load-bearing — sans eux serde émet
//! `space_id` et `{"Expires":{…}}`, que le front ne sait pas relire.
//! `tests/ipc_contract.rs` les fige.

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::language::{Language, detect};
use super::tag;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub space_id: String,
    /// Peut être vide : l'interface affiche alors un libellé traduit.
    pub title: String,
    pub language: Language,
    pub content: String,
    /// Fil d'Ariane libre, ex. "API Gateway / Auth". Peut être vide.
    pub source: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub lifecycle: NoteLifecycle,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteLifecycle {
    Permanent,
    /// « À trier » jusqu'à cette date.
    Expires {
        at: DateTime<Utc>,
    },
}

/// Ni identifiant ni horodatages : la persistance les attribue.
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub space_id: String,
    pub title: String,
    pub language: Language,
    pub content: String,
    pub source: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub lifecycle: NoteLifecycle,
}

/// Un champ à `None` reste **inchangé** en base.
///
/// `#[specta(optional)]` rend les clés omissibles côté TypeScript. Sans lui le
/// front devrait envoyer des `null` pour les champs qu'il ne touche pas — donc
/// écraser ce qu'il voulait laisser intact.
#[derive(Debug, Clone, Default, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    #[specta(optional)]
    pub space_id: Option<String>,
    #[specta(optional)]
    pub title: Option<String>,
    #[specta(optional)]
    pub language: Option<Language>,
    #[specta(optional)]
    pub content: Option<String>,
    #[specta(optional)]
    pub source: Option<String>,
    #[specta(optional)]
    pub tags: Option<Vec<String>>,
    #[specta(optional)]
    pub pinned: Option<bool>,
    #[specta(optional)]
    pub lifecycle: Option<NoteLifecycle>,
}

impl NoteDraft {
    /// Langage deviné si le front n'en a pas choisi, tags normalisés : ces deux
    /// règles vivent ici, pas dans le SQL.
    pub fn into_note(self, id: String, now: DateTime<Utc>) -> Note {
        let language = detect::for_draft(&self);
        let tags = tag::normalize(&self.tags);

        Note {
            id,
            space_id: self.space_id,
            title: self.title,
            language,
            content: self.content,
            source: self.source,
            tags,
            pinned: self.pinned,
            created_at: now,
            updated_at: now,
            lifecycle: self.lifecycle,
        }
    }
}

impl NotePatch {
    /// Applique les champs renseignés et rafraîchit `updated_at` ; un `None`
    /// laisse la note intacte.
    ///
    /// La détection de langage est décidée sur l'état **d'avant** patch : c'est
    /// lui qui dit si la note reçoit là son premier contenu.
    ///
    /// ⚠️ Ne vérifie pas que `space_id` existe — seule la persistance peut le
    /// voir, et elle le fait avant d'appeler.
    pub fn apply(&self, note: &mut Note, now: DateTime<Utc>) {
        let detected = detect::after_patch(note, self);

        if let Some(space_id) = &self.space_id {
            note.space_id.clone_from(space_id);
        }
        if let Some(title) = &self.title {
            note.title.clone_from(title);
        }
        if let Some(language) = self.language {
            note.language = language;
        }
        if let Some(content) = &self.content {
            note.content.clone_from(content);
        }
        if let Some(language) = detected {
            note.language = language;
        }
        if let Some(source) = &self.source {
            note.source.clone_from(source);
        }
        if let Some(pinned) = self.pinned {
            note.pinned = pinned;
        }
        if let Some(tags) = &self.tags {
            note.tags = tag::normalize(tags);
        }
        if let Some(lifecycle) = &self.lifecycle {
            note.lifecycle = lifecycle.clone();
        }

        note.updated_at = now;
    }
}

/// Seuil **unique** de « bientôt à trier » : le front en tenait un second.
const EXPIRING_SOON: TimeDelta = TimeDelta::days(3);

/// Pied d'une carte : la **décision**, pas le rendu. Les variantes datées
/// portent une date et non un libellé — « il y a 4 min » doit vieillir tout seul
/// à l'écran, donc le formatage reste au front.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteFooter {
    Source { value: String },
    Expiry { at: DateTime<Utc> },
    Age { at: DateTime<Utc> },
}

/// `flatten` aplatit la note dans le même objet JSON : le front n'a qu'un seul
/// type de note.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DisplayNote {
    #[serde(flatten)]
    pub note: Note,
    pub footer: NoteFooter,
    pub expiring_soon: bool,
}

/// Pour lire `note.id` plutôt que `note.note.id`.
impl std::ops::Deref for DisplayNote {
    type Target = Note;

    fn deref(&self) -> &Self::Target {
        &self.note
    }
}

pub fn decorate(note: Note, now: DateTime<Utc>) -> DisplayNote {
    DisplayNote {
        footer: footer_of(&note),
        expiring_soon: expires_soon(&note, now),
        note,
    }
}

/// Contrairement à une requête, la création et la mise à jour ne reçoivent pas
/// d'instant de référence du front.
pub fn decorate_now(note: Note) -> DisplayNote {
    decorate(note, Utc::now())
}

fn footer_of(note: &Note) -> NoteFooter {
    if let NoteLifecycle::Expires { at } = note.lifecycle {
        return NoteFooter::Expiry { at };
    }

    // Le premier segment situe la note sans déborder de la carte.
    if note.pinned
        && let Some(root) = note
            .source
            .split(" / ")
            .next()
            .filter(|root| !root.is_empty())
    {
        return NoteFooter::Source {
            value: root.to_string(),
        };
    }

    NoteFooter::Age {
        at: note.updated_at,
    }
}

fn expires_soon(note: &Note, now: DateTime<Utc>) -> bool {
    let NoteLifecycle::Expires { at } = note.lifecycle else {
        return false;
    };

    // Une durée, pas un nombre de jours entiers : à 3 jours et 1 heure, un
    // arrondi basculerait la note en alerte un jour trop tôt.
    at.signed_duration_since(now) <= EXPIRING_SOON
}

#[cfg(test)]
mod tests;
