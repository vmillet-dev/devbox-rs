//! The note: what is persisted ([`Note`]) and what is displayed ([`DisplayNote`]).
//!
//! [`normalize_tags`] lives here and **only here**: both writing and querying
//! pass through it, otherwise a typed `#urgent` would not find the stored `urgent`.
//!
//! ⚠️ `rename_all` and `tag = "kind"` are load-bearing — without them serde emits
//! `space_id` and `{"Expires":{…}}`, which the front end cannot read back.
//! `tests/ipc_contract.rs` freezes them.

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::language::{self, Language};
use super::placeholder::{self, Placeholder};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub space_id: String,
    /// Can be empty: the interface then displays a translated label.
    pub title: String,
    pub language: Language,
    pub content: String,
    /// Breadcrumb, e.g. "API Gateway / Auth". Can be empty.
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
    /// "Untriaged" until this date.
    Expires {
        at: DateTime<Utc>,
    },
}

/// Neither identifier nor timestamps: persistence assigns them.
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

/// A field set to `None` remains **unchanged** in the database.
///
/// `#[specta(optional)]` makes keys omissible on the TypeScript side. Without it, the
/// front end would have to send `null` for fields it doesn't touch — thus
/// overwriting what it wanted to leave intact.
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
    /// Language guessed if the front end didn't choose one, normalized tags: these two
    /// rules live here, not in the SQL.
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
    /// Applies the provided fields and refreshes `updated_at`; a `None`
    /// leaves the note intact.
    ///
    /// Language detection is decided on the **pre-patch** state: it is
    /// it who says if the note receives there its first content.
    ///
    /// ⚠️ Does not check that `space_id` exists — only persistence can
    /// see it, and it does so before calling.
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

/// **Single** "untriaged soon" threshold: the front end had a second one.
const EXPIRING_SOON: TimeDelta = TimeDelta::days(3);

/// Card footer: the **decision**, not the rendering. The dated variants
/// carry a date and not a label — "4 min ago" must age by itself
/// on the screen, so formatting remains on the front end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteFooter {
    Source { value: String },
    Expiry { at: DateTime<Utc> },
    Age { at: DateTime<Utc> },
}

/// `flatten` flattens the note into the same JSON object: the front end only has a single
/// note type.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DisplayNote {
    #[serde(flatten)]
    pub note: Note,
    pub footer: NoteFooter,
    pub expiring_soon: bool,
    /// Champs `{{…}}` du contenu : la carte propose de les remplir avant de
    /// copier. Dérivés, jamais écrits.
    pub placeholders: Vec<Placeholder>,
    /// Renseigné après coup par ce qui dispose d'une connexion — `decorate` ne
    /// lit pas la base. Zéro tant que personne ne l'a rempli.
    pub attachment_count: u32,
}

/// To read `note.id` instead of `note.note.id`.
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
        placeholders: placeholder::parse(&note.content),
        attachment_count: 0,
        note,
    }
}

/// Unlike a query, creation and update do not receive a reference
/// instant from the front end.
pub fn decorate_now(note: Note) -> DisplayNote {
    decorate(note, Utc::now())
}

fn footer_of(note: &Note) -> NoteFooter {
    if let NoteLifecycle::Expires { at } = note.lifecycle {
        return NoteFooter::Expiry { at };
    }

    // The first segment locates the note without overflowing the card.
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

    // A duration, not a number of whole days: at 3 days and 1 hour,
    // rounding down would switch the note to alert one day too early.
    at.signed_duration_since(now) <= EXPIRING_SOON
}

/// Un tag du corpus et le nombre de notes vivantes qui le portent : de quoi
/// décider quoi renommer, fusionner ou jeter.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagUsage {
    pub tag: String,
    pub note_count: u32,
}

/// Un tag saisi pour être **écrit sur tout le corpus** (renommage, fusion) passe
/// par la même normalisation que les autres, mais son échec est une erreur : un
/// silence renommerait vers rien.
pub fn validated_tag(raw: &str) -> Result<String, crate::error::ValidationError> {
    normalize_tags(std::slice::from_ref(&raw.to_string()))
        .into_iter()
        .next()
        .ok_or_else(|| crate::error::ValidationError::new("tag", "a tag must have a readable name"))
}

/// Trim, leading `#`, blanks, and duplicates.
///
/// Single rule: the front end sends what the user typed, both writing
/// and querying go through here — otherwise a typed `#urgent` would not find the
/// stored `urgent`. De-duplication is case-insensitive and keeps the
/// first spelling; `COLLATE NOCASE` (migration 2) extends the rule to the corpus.
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
        assert_eq!(note.content, "Content");
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
