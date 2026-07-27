//! Ce que la carte d'une note affiche — la **décision**, pas le rendu.
//!
//! # Où passe la frontière
//!
//! Le back décide *quoi* montrer, le front décide *comment* le rendre. Un pied
//! de carte peut porter trois choses selon la note, et ce choix est une règle
//! produit : il vit donc ici, pas dans un composant Angular.
//!
//! En revanche les variantes portent une **date**, pas un libellé. « il y a
//! 4 min » doit vieillir tout seul à l'écran ; le calculer ici figerait le texte
//! jusqu'à la requête suivante, ou imposerait un aller-retour IPC toutes les
//! 30 secondes. Le formatage — et lui seul — reste au front.

use chrono::{DateTime, FixedOffset, Utc};
use serde::Serialize;

use super::note::{Note, NoteLifecycle};

/// Au-delà de ce délai, une note éphémère n'est plus « bientôt à trier ».
///
/// Seuil **unique**. Il vivait auparavant côté front pendant que le back
/// calculait de son côté « la section contient une note qui expire » : deux
/// définitions de « bientôt » pour un libellé qui n'en promet qu'une.
const EXPIRING_SOON_DAYS: i64 = 3;

const MS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

/// Contenu du pied d'une carte.
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

/// Une note augmentée de ce que l'affichage a besoin de savoir.
///
/// `#[serde(flatten)]` aplatit la note dans l'objet JSON : le front reçoit un
/// seul objet et n'a donc qu'un seul type de note. Côté Rust les deux restent
/// distincts — [`Note`] est ce qui est **persisté**, `DisplayNote` ce qui est
/// **affiché**, et la persistance ignore tout du second.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayNote {
    #[serde(flatten)]
    pub note: Note,
    pub footer: NoteFooter,
    pub expiring_soon: bool,
}

/// Une note décorée reste une note : lire `display_note.id` plutôt que
/// `display_note.note.id` évite de faire remonter l'emballage chez l'appelant.
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

/// Décoration d'une note qu'on vient d'écrire : `create_note` et `update_note`
/// ne reçoivent pas d'instant de référence du front, contrairement à une requête.
pub fn decorate_now(note: Note) -> DisplayNote {
    decorate(note, &Utc::now().fixed_offset())
}

fn footer_of(note: &Note) -> NoteFooter {
    if let NoteLifecycle::Expires { at } = &note.lifecycle {
        return NoteFooter::Expiry { at: at.clone() };
    }

    // Le chemin de contexte est un fil d'Ariane ("API Gateway / Auth") : son
    // premier segment suffit à situer la note sans déborder de la carte.
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

/// Une échéance illisible ne rend pas la note urgente : elle relève de la
/// corruption, et l'afficher en alerte serait un faux signal permanent.
fn expires_soon(note: &Note, now: &DateTime<FixedOffset>) -> bool {
    let NoteLifecycle::Expires { at } = &note.lifecycle else {
        return false;
    };
    let Ok(deadline) = DateTime::parse_from_rfc3339(at) else {
        return false;
    };

    // Comparaison en millisecondes et non en jours entiers : à 3 jours et 1
    // heure, un arrondi au jour basculerait la note en alerte un jour trop tôt.
    deadline.signed_duration_since(*now).num_milliseconds() <= EXPIRING_SOON_DAYS * MS_PER_DAY
}

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
