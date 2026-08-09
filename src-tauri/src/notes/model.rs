//! La note : ce qui est persisté ([`Note`]) et ce qui est affiché ([`DisplayNote`]).
//!
//! [`normalize_tags`] vit ici et **seulement ici** : l'écriture comme la requête
//! y passent, sinon un `#urgent` saisi ne retrouverait pas le `urgent` stocké.
//!
//! ⚠️ `rename_all` et `tag = "kind"` sont load-bearing — sans eux serde émet
//! `space_id` et `{"Expires":{…}}`, que le front ne sait pas relire.
//! `tests/ipc_contract.rs` les fige.

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::language::{self, Language};

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
        let language = language::for_draft(&self);
        let tags = normalize_tags(&self.tags);

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
        let detected = language::after_patch(note, self);

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
            note.tags = normalize_tags(tags);
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

/// Trim, `#` de tête, vides et doublons.
///
/// Règle unique : le front envoie ce que l'utilisateur a tapé, l'écriture comme
/// la requête passent par ici — sinon un `#urgent` saisi ne retrouverait pas le
/// `urgent` stocké. La déduplication est insensible à la casse et garde la
/// première graphie ; `COLLATE NOCASE` (migration 2) prolonge la règle au corpus.
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut normalized: Vec<String> = Vec::new();

    for tag in tags {
        let cleaned = tag.trim().trim_start_matches('#').trim();
        if cleaned.is_empty() {
            continue;
        }

        let folded = cleaned.to_lowercase();
        if seen.contains(&folded) {
            continue;
        }

        seen.push(folded);
        normalized.push(cleaned.to_string());
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::fixtures::note as sample;

    const NOW: &str = "2026-07-25T09:00:00.000Z";

    fn at(iso: &str) -> DateTime<Utc> {
        crate::db::iso8601::parse(iso).unwrap()
    }

    fn normalized(tags: &[&str]) -> Vec<String> {
        normalize_tags(&tags.iter().copied().map(String::from).collect::<Vec<_>>())
    }

    #[test]
    fn padding_and_blanks_are_dropped() {
        assert_eq!(
            normalized(&["  urgent ", "", "   ", "later"]),
            ["urgent", "later"]
        );
    }

    #[test]
    fn a_duplicate_keeps_its_first_spelling() {
        assert_eq!(normalized(&["Urgent", "urgent", "URGENT"]), ["Urgent"]);
    }

    #[test]
    fn only_leading_hashes_are_stripped() {
        assert_eq!(normalized(&["##c++", "a#b"]), ["c++", "a#b"]);
    }

    #[test]
    fn a_tag_reduced_to_nothing_is_dropped_rather_than_stored_empty() {
        // " # " trims to "#", then to "" — storing that would put a blank facet
        // in the rail that selects every note carrying it.
        assert!(normalized(&[" # ", "#"]).is_empty());
    }

    #[test]
    fn tag_case_folding_reaches_beyond_ascii() {
        // SQLite's NOCASE would not collapse these; `to_lowercase` is Unicode.
        assert_eq!(normalized(&["Étape", "étape"]), ["Étape"]);
    }

    fn now() -> DateTime<Utc> {
        at(NOW)
    }

    fn expiring(at_iso: &str) -> Note {
        Note {
            lifecycle: NoteLifecycle::Expires { at: at(at_iso) },
            ..sample()
        }
    }

    fn draft(language: Language, content: &str) -> NoteDraft {
        NoteDraft {
            space_id: "s-1".to_string(),
            title: "Titre".to_string(),
            language,
            content: content.to_string(),
            source: "API Gateway".to_string(),
            tags: vec!["  #Urgent ".to_string(), "urgent".to_string()],
            pinned: true,
            lifecycle: NoteLifecycle::Permanent,
        }
    }

    #[test]
    fn a_draft_becomes_a_note_carrying_the_id_and_the_instant_it_was_given() {
        let note = draft(Language::Md, "du texte").into_note("n-7".to_string(), now());

        assert_eq!(note.id, "n-7");
        assert_eq!(note.created_at, now());
        assert_eq!(note.updated_at, now());
    }

    #[test]
    fn turning_a_draft_into_a_note_detects_the_language_and_normalises_the_tags() {
        // Both rules used to run in `storage`, where they needed an open database
        // to be exercised at all.
        let note = draft(Language::Txt, "{\"a\": 1}").into_note("n-7".to_string(), now());

        assert_eq!(note.language, Language::Json);
        assert_eq!(note.tags, ["Urgent"]);
    }

    #[test]
    fn turning_a_draft_into_a_note_leaves_everything_else_alone() {
        let note = draft(Language::Md, "SELECT 1").into_note("n-7".to_string(), now());

        // A chosen language is a decision; only the rest travels verbatim.
        assert_eq!(note.language, Language::Md);
        assert_eq!(note.content, "SELECT 1");
        assert_eq!(note.space_id, "s-1");
        assert_eq!(note.source, "API Gateway");
        assert!(note.pinned);
    }

    #[test]
    fn a_patch_only_touches_the_fields_it_carries() {
        let mut note = sample();
        let patch = NotePatch {
            title: Some("Nouveau".to_string()),
            ..NotePatch::default()
        };

        patch.apply(&mut note, at("2026-07-25T10:00:00.000Z"));

        assert_eq!(note.title, "Nouveau");
        assert_eq!(note.content, "Contenu");
        assert_eq!(note.tags, ["auth"]);
        assert_eq!(note.updated_at, at("2026-07-25T10:00:00.000Z"));
        // `created_at` is the one stamp nothing may move.
        assert_eq!(note.created_at, now());
    }

    #[test]
    fn a_patch_normalises_the_tags_it_replaces() {
        let mut note = sample();
        let patch = NotePatch {
            tags: Some(vec![
                "  #Ops ".to_string(),
                "OPS".to_string(),
                " ".to_string(),
            ]),
            ..NotePatch::default()
        };

        patch.apply(&mut note, now());

        assert_eq!(note.tags, ["Ops"]);
    }

    #[test]
    fn a_patch_filling_an_empty_note_detects_its_language() {
        // Decided on the state *before* the patch: that is what says whether the
        // note is receiving its first content.
        let mut note = Note {
            language: Language::Txt,
            content: String::new(),
            ..sample()
        };
        let patch = NotePatch {
            content: Some("SELECT 1".to_string()),
            ..NotePatch::default()
        };

        patch.apply(&mut note, now());

        assert_eq!(note.language, Language::Sql);
    }

    #[test]
    fn an_ordinary_note_shows_the_age_of_its_last_change() {
        let footer = footer_of(&sample());

        assert_eq!(footer, NoteFooter::Age { at: at(NOW) });
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
        assert!(!expires_soon(&sample(), now()));
    }

    #[test]
    fn the_threshold_is_measured_in_fractions_of_a_day() {
        // Three days and one hour is not "soon"; rounding to whole days would
        // raise the alert a day early.
        assert!(!expires_soon(&expiring("2026-07-28T10:00:00.000Z"), now()));
        assert!(expires_soon(&expiring("2026-07-28T08:00:00.000Z"), now()));
    }

    #[test]
    fn an_already_expired_note_counts_as_expiring_soon() {
        assert!(expires_soon(&expiring("2026-07-01T00:00:00.000Z"), now()));
    }
}
