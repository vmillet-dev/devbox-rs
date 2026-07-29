//! La note : ce qui est persisté ([`Note`]) et ce qui est affiché
//! ([`DisplayNote`]). La persistance ignore tout du second.
//!
//! ⚠️ **Contrat de sérialisation.** Deux attributs sont indispensables, sinon le
//! front reçoit des données qu'il ne sait pas relire :
//! - `rename_all = "camelCase"`, sans quoi serde émet `space_id` là où le DTO
//!   TypeScript attend `spaceId` ;
//! - `tag = "kind"` sur les enums à données, dont la représentation serde par
//!   défaut est `{"Expires":{…}}` alors que le front discrimine sur `kind`.
//!
//! Les dates transitent en chaîne ISO 8601 UTC (JSON n'a pas de type date).
//!
//! Les variantes de pied de carte portent une **date**, pas un libellé : « il y
//! a 4 min » doit vieillir tout seul à l'écran. Le formatage reste au front.

use chrono::{DateTime, FixedOffset, Utc};
use serde::{Deserialize, Serialize};

use super::rules::{self, ValidationError};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// Espace de rangement. C'est la requête qui filtre dessus ; le stockage
    /// refuse de créer une note dans un espace inconnu.
    pub space_id: String,
    /// Peut être vide : une note fraîchement créée n'a pas encore de titre,
    /// l'interface affiche un libellé traduit à la place.
    pub title: String,
    /// "json" | "js" | "py" | "sql" | "yml" | "txt".
    pub language: String,
    pub content: String,
    /// Chemin de contexte libre, ex. "API Gateway / Auth". Peut être vide.
    pub source: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    /// ISO 8601, ex. "2026-07-25T09:12:00.000Z".
    pub created_at: String,
    pub updated_at: String,
    pub lifecycle: NoteLifecycle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteLifecycle {
    /// Note permanente.
    Permanent,
    /// Note éphémère : elle est « à trier » jusqu'à cette date.
    Expires { at: String },
}

/// Création : ni identifiant ni horodatages — c'est la persistance qui les attribue.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub space_id: String,
    pub title: String,
    pub language: String,
    pub content: String,
    pub source: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub lifecycle: NoteLifecycle,
}

/// Modification partielle : un champ à `None` reste **inchangé** en base.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    /// Renseigné uniquement lors d'un déplacement de note vers un autre espace.
    pub space_id: Option<String>,
    pub title: Option<String>,
    pub language: Option<String>,
    pub content: Option<String>,
    pub source: Option<String>,
    pub tags: Option<Vec<String>>,
    pub pinned: Option<bool>,
    pub lifecycle: Option<NoteLifecycle>,
}

impl NoteDraft {
    pub fn validate(&self) -> Result<(), ValidationError> {
        rules::validate_language(&self.language)
    }
}

impl NotePatch {
    /// Un champ absent n'est pas validé : il ne sera pas écrit.
    pub fn validate(&self) -> Result<(), ValidationError> {
        match &self.language {
            Some(language) => rules::validate_language(language),
            None => Ok(()),
        }
    }
}

/// Au-delà de ce délai, une note éphémère n'est plus « bientôt à trier ».
/// Seuil **unique** : le front en tenait un second, pour un libellé qui ne
/// promet qu'une définition de « bientôt ».
const EXPIRING_SOON_DAYS: i64 = 3;

const MS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

/// Contenu du pied d'une carte — la **décision**, pas le rendu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteFooter {
    /// Note épinglée portant un contexte : elle est là pour durer, savoir d'où
    /// elle vient est plus utile que son âge.
    Source { value: String },
    /// Échéance d'une note éphémère.
    Expiry { at: String },
    /// Âge de la dernière modification — le cas ordinaire.
    Age { at: String },
}

/// Note augmentée de ce que l'affichage doit savoir. `flatten` aplatit la note
/// dans l'objet JSON : le front n'a qu'un seul type de note.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayNote {
    #[serde(flatten)]
    pub note: Note,
    pub footer: NoteFooter,
    pub expiring_soon: bool,
}

/// Lire `display_note.id` plutôt que `display_note.note.id` évite de faire
/// remonter l'emballage chez l'appelant.
impl std::ops::Deref for DisplayNote {
    type Target = Note;

    fn deref(&self) -> &Self::Target {
        &self.note
    }
}

pub fn decorate(note: Note, now: &DateTime<FixedOffset>) -> DisplayNote {
    DisplayNote {
        footer: footer_of(&note),
        expiring_soon: expires_soon(&note, now),
        note,
    }
}

/// Pour une note qu'on vient d'écrire : `create_note` et `update_note` ne
/// reçoivent pas d'instant de référence du front, contrairement à une requête.
pub fn decorate_now(note: Note) -> DisplayNote {
    decorate(note, &Utc::now().fixed_offset())
}

fn footer_of(note: &Note) -> NoteFooter {
    if let NoteLifecycle::Expires { at } = &note.lifecycle {
        return NoteFooter::Expiry { at: at.clone() };
    }

    // `source` est un fil d'Ariane ("API Gateway / Auth") : son premier segment
    // situe la note sans déborder de la carte.
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
        at: note.updated_at.clone(),
    }
}

/// Une échéance illisible ne rend pas la note urgente : ce serait un faux signal
/// permanent.
fn expires_soon(note: &Note, now: &DateTime<FixedOffset>) -> bool {
    let NoteLifecycle::Expires { at } = &note.lifecycle else {
        return false;
    };
    let Ok(deadline) = DateTime::parse_from_rfc3339(at) else {
        return false;
    };

    // En millisecondes et non en jours entiers : à 3 jours et 1 heure, un
    // arrondi basculerait la note en alerte un jour trop tôt.
    deadline.signed_duration_since(*now).num_milliseconds() <= EXPIRING_SOON_DAYS * MS_PER_DAY
}

/// Ces tests figent la **forme JSON** traversant le pont : la seule chose que le
/// compilateur ne peut pas contrôler et qui casse silencieusement le front.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::fixtures::note as sample;

    const NOW: &str = "2026-07-25T09:00:00.000Z";

    fn now() -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(NOW).unwrap()
    }

    fn expiring(at: &str) -> Note {
        Note {
            lifecycle: NoteLifecycle::Expires { at: at.to_string() },
            ..sample()
        }
    }

    #[test]
    fn a_note_serialises_with_camel_case_keys() {
        let json = serde_json::to_value(sample()).unwrap();

        // The TypeScript DTO reads `spaceId` / `createdAt` / `updatedAt`; serde's
        // default would emit the snake_case field names and the front would see
        // `undefined` where it expects an ISO date.
        assert!(json.get("spaceId").is_some());
        assert!(json.get("createdAt").is_some());
        assert!(json.get("updatedAt").is_some());
        assert!(json.get("space_id").is_none());
        assert!(json.get("created_at").is_none());
    }

    #[test]
    fn a_permanent_lifecycle_serialises_as_a_tagged_object() {
        let json = serde_json::to_value(sample()).unwrap();

        // Not serde's default `"Permanent"` — the front discriminates on `kind`.
        assert_eq!(
            json["lifecycle"],
            serde_json::json!({ "kind": "permanent" })
        );
    }

    #[test]
    fn an_expiring_lifecycle_serialises_flat_with_its_date() {
        let note = Note {
            lifecycle: NoteLifecycle::Expires {
                at: "2026-08-01T00:00:00.000Z".to_string(),
            },
            ..sample()
        };

        let json = serde_json::to_value(note).unwrap();

        // Not `{"Expires":{"at":…}}`, which the TS discriminated union rejects.
        assert_eq!(
            json["lifecycle"],
            serde_json::json!({ "kind": "expires", "at": "2026-08-01T00:00:00.000Z" })
        );
    }

    #[test]
    fn a_patch_omitting_a_field_deserialises_to_none() {
        // `toNotePatchDto` copies field by field precisely so that untouched
        // fields are absent rather than null; absent must mean "leave alone".
        let patch: NotePatch = serde_json::from_value(serde_json::json!({
            "title": "Nouveau titre"
        }))
        .unwrap();

        assert_eq!(patch.title.as_deref(), Some("Nouveau titre"));
        assert!(patch.content.is_none());
        assert!(patch.tags.is_none());
        assert!(patch.lifecycle.is_none());
    }

    #[test]
    fn a_draft_is_read_from_the_camel_case_payload_the_front_sends() {
        let draft: NoteDraft = serde_json::from_value(serde_json::json!({
            "spaceId": "s-1",
            "title": "",
            "language": "sql",
            "content": "SELECT 1",
            "source": "",
            "tags": ["db"],
            "pinned": true,
            "lifecycle": { "kind": "expires", "at": "2026-08-01T00:00:00.000Z" }
        }))
        .unwrap();

        assert_eq!(draft.space_id, "s-1");
        assert!(draft.pinned);
        assert!(matches!(draft.lifecycle, NoteLifecycle::Expires { .. }));
    }

    #[test]
    fn an_ordinary_note_shows_the_age_of_its_last_change() {
        let footer = footer_of(&sample());

        assert_eq!(
            footer,
            NoteFooter::Age {
                at: "2026-07-25T09:00:00.000Z".to_string()
            }
        );
    }

    #[test]
    fn a_pinned_note_shows_the_first_segment_of_its_context() {
        let note = Note {
            pinned: true,
            source: "API Gateway / Auth / Tokens".to_string(),
            ..sample()
        };

        assert_eq!(
            footer_of(&note),
            NoteFooter::Source {
                value: "API Gateway".to_string()
            }
        );
    }

    #[test]
    fn a_pinned_note_without_context_falls_back_to_its_age() {
        let note = Note {
            pinned: true,
            source: String::new(),
            ..sample()
        };

        assert!(matches!(footer_of(&note), NoteFooter::Age { .. }));
    }

    #[test]
    fn an_expiring_note_shows_its_deadline_even_when_pinned() {
        let note = Note {
            pinned: true,
            source: "API Gateway".to_string(),
            ..expiring("2026-08-01T00:00:00.000Z")
        };

        // The deadline is the more urgent thing to know; the context can wait.
        assert!(matches!(footer_of(&note), NoteFooter::Expiry { .. }));
    }

    #[test]
    fn a_permanent_note_never_counts_as_expiring_soon() {
        assert!(!expires_soon(&sample(), &now()));
    }

    #[test]
    fn the_threshold_is_measured_in_fractions_of_a_day() {
        // Three days and one hour is not "soon"; rounding to whole days would
        // raise the alert a day early.
        assert!(!expires_soon(&expiring("2026-07-28T10:00:00.000Z"), &now()));
        assert!(expires_soon(&expiring("2026-07-28T08:00:00.000Z"), &now()));
    }

    #[test]
    fn an_already_expired_note_counts_as_expiring_soon() {
        assert!(expires_soon(&expiring("2026-07-01T00:00:00.000Z"), &now()));
    }

    #[test]
    fn an_unreadable_deadline_does_not_raise_a_permanent_alert() {
        assert!(!expires_soon(&expiring("pas une date"), &now()));
    }

    #[test]
    fn a_decorated_note_serialises_flat_with_its_footer() {
        let json = serde_json::to_value(decorate(sample(), &now())).unwrap();

        // The front reads one object: the note's own fields sit alongside the
        // display ones, not nested under a `note` key.
        assert_eq!(json["id"], "n-1");
        assert_eq!(json["spaceId"], "s-1");
        assert_eq!(json["expiringSoon"], false);
        assert_eq!(
            json["footer"],
            serde_json::json!({ "kind": "age", "at": "2026-07-25T09:00:00.000Z" })
        );
        assert!(json.get("note").is_none());
    }

    #[test]
    fn a_source_footer_serialises_with_the_kind_the_front_discriminates_on() {
        let note = Note {
            pinned: true,
            source: "API Gateway / Auth".to_string(),
            ..sample()
        };

        let json = serde_json::to_value(decorate(note, &now())).unwrap();

        assert_eq!(
            json["footer"],
            serde_json::json!({ "kind": "source", "value": "API Gateway" })
        );
    }
}
