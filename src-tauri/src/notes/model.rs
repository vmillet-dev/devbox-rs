//! ⚠️ `rename_all` and `tag = "kind"` are load-bearing: without them serde emits
//! `space_id` and `{"Expires":{…}}`, which the front end cannot read back.

use std::collections::BTreeMap;

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::checklist::{self, ChecklistItem, NoteKind};
use super::language::{self, Language};
use super::placeholder::{self, Placeholder};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub space_id: String,
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
    /// ⚠️ `default`: `transfer::Bundle` deserializes `Note` itself, and a required
    /// key would make every export file written before todo-lists unreadable.
    #[serde(default)]
    pub kind: NoteKind,
    /// Empty for a snippet. A checklist has these **instead of** `content`.
    #[serde(default)]
    pub items: Vec<ChecklistItem>,
    /// Written by `set_placeholder_values` and by nothing else: filling a field is
    /// not editing the note, so it leaves `updated_at` alone.
    #[serde(default)]
    pub placeholder_values: BTreeMap<String, String>,
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
    #[serde(default)]
    pub kind: NoteKind,
    #[serde(default)]
    pub items: Vec<ChecklistItem>,
}

/// A field set to `None` stays **unchanged**. `#[specta(optional)]` makes the key
/// omissible on the TypeScript side; without it the front would send `null` for
/// what it does not touch, overwriting it.
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
    #[specta(optional)]
    pub kind: Option<NoteKind>,
    /// Replaces the **whole** list, like `tags`: a position is all the identity an
    /// item has.
    #[specta(optional)]
    pub items: Option<Vec<ChecklistItem>>,
}

impl NoteDraft {
    /// A checklist is exempt from language detection — it has no body to read.
    pub fn into_note(self, id: String, now: DateTime<Utc>) -> Note {
        let language = if self.kind == NoteKind::Checklist {
            Language::default()
        } else {
            language::for_draft(&self)
        };
        let tags = normalize_tags(&self.tags);
        let items = checklist::normalize_items(&self.items);

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
            kind: self.kind,
            items,
            placeholder_values: BTreeMap::new(),
        }
    }
}

impl NotePatch {
    /// ⚠️ Does not check that `space_id` exists — only persistence can, and it does
    /// so before calling.
    pub fn apply(&self, note: &mut Note, now: DateTime<Utc>) {
        // Skipped once the note is — or becomes — a checklist: no body to read.
        let becomes_checklist = self.kind.unwrap_or(note.kind) == NoteKind::Checklist;
        let detected = if becomes_checklist {
            None
        } else {
            language::after_patch(note, self)
        };

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
        if let Some(kind) = self.kind {
            note.kind = kind;
        }
        if let Some(items) = &self.items {
            note.items = checklist::normalize_items(items);
        }

        note.updated_at = now;
    }
}

const EXPIRING_SOON: TimeDelta = TimeDelta::days(3);

/// The **decision**, not the rendering: the dated variants carry a date and not a
/// label — "4 min ago" has to age on screen without a round trip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteFooter {
    Source { value: String },
    Expiry { at: DateTime<Utc> },
    Age { at: DateTime<Utc> },
}

/// `flatten`: the front end has a single note type.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DisplayNote {
    #[serde(flatten)]
    pub note: Note,
    pub footer: NoteFooter,
    pub expiring_soon: bool,
    /// The **list** is derived from the text; the values are persisted.
    pub placeholders: Vec<Placeholder>,
    /// Filled in afterwards by whoever holds a connection: `decorate` reads no database.
    pub attachment_count: u32,
    /// What copying puts on the clipboard when that is **not** the content: a todo
    /// list travels as the Markdown of its items, a snippet as `None`. Decided here
    /// so `checklist::to_markdown` stays the only place the `- [x] ` syntax exists.
    pub copy_text: Option<String>,
}

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
        placeholders: placeholder::parse(&note.content, &note.placeholder_values),
        attachment_count: 0,
        copy_text: match note.kind {
            NoteKind::Checklist => Some(checklist::to_markdown(&note.items)),
            NoteKind::Snippet => None,
        },
        note,
    }
}

pub fn decorate_now(note: Note) -> DisplayNote {
    decorate(note, Utc::now())
}

/// ⚠️ They override the default written in the text but **do not touch** what was
/// typed on the note: copying one into `value` would freeze the variable the day
/// it changes.
pub fn apply_global_defaults(note: &mut DisplayNote, globals: &BTreeMap<String, String>) {
    for placeholder in &mut note.placeholders {
        if let Some(value) = globals.get(&placeholder.name) {
            placeholder.default_value.clone_from(value);
        }
    }
}

fn footer_of(note: &Note) -> NoteFooter {
    if let NoteLifecycle::Expires { at } = note.lifecycle {
        return NoteFooter::Expiry { at };
    }

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

    // A duration, not a number of whole days: at 3 days and 1 hour, rounding down
    // would switch the note to alert a day early.
    at.signed_duration_since(now) <= EXPIRING_SOON
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagUsage {
    pub tag: String,
    pub note_count: u32,
}

/// Written across the whole corpus (rename, merge), so its failure is an error:
/// staying silent would rename onto nothing.
pub fn validated_tag(raw: &str) -> Result<String, crate::error::ValidationError> {
    normalize_tags(std::slice::from_ref(&raw.to_string()))
        .into_iter()
        .next()
        .ok_or_else(|| crate::error::ValidationError::new("tag", "a tag must have a readable name"))
}

/// Split out of [`normalize_tags`] so a caller that only needs to know whether a
/// tag was selected can ask without building the list.
pub fn normalize_tag(tag: &str) -> Option<&str> {
    let cleaned = tag.trim().trim_start_matches('#').trim();

    (!cleaned.is_empty()).then_some(cleaned)
}

/// Trim, leading `#`, blanks, duplicates. Both writing and querying go through
/// here, or a typed `#urgent` would not find the stored `urgent`. De-duplication
/// is case-insensitive and keeps the first spelling, like `COLLATE NOCASE`.
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut normalized: Vec<String> = Vec::new();

    for tag in tags {
        let Some(cleaned) = normalize_tag(tag) else {
            continue;
        };

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
        assert!(normalized(&[" # ", "#"]).is_empty());
    }

    #[test]
    fn tag_case_folding_reaches_beyond_ascii() {
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
            title: "Title".to_string(),
            language,
            content: content.to_string(),
            source: "API Gateway".to_string(),
            tags: vec!["  #Urgent ".to_string(), "urgent".to_string()],
            pinned: true,
            lifecycle: NoteLifecycle::Permanent,
            kind: NoteKind::Snippet,
            items: Vec::new(),
        }
    }

    #[test]
    fn a_draft_becomes_a_note_carrying_the_id_and_the_instant_it_was_given() {
        let note = draft(Language::Md, "some prose").into_note("n-7".to_string(), now());

        assert_eq!(note.id, "n-7");
        assert_eq!(note.created_at, now());
        assert_eq!(note.updated_at, now());
    }

    #[test]
    fn turning_a_draft_into_a_note_detects_the_language_and_normalizes_the_tags() {
        let note = draft(Language::Txt, "{\"a\": 1}").into_note("n-7".to_string(), now());

        assert_eq!(note.language, Language::Json);
        assert_eq!(note.tags, ["Urgent"]);
    }

    #[test]
    fn turning_a_draft_into_a_note_leaves_everything_else_alone() {
        let note = draft(Language::Md, "SELECT 1").into_note("n-7".to_string(), now());

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
            title: Some("New".to_string()),
            ..NotePatch::default()
        };

        patch.apply(&mut note, at("2026-07-25T10:00:00.000Z"));

        assert_eq!(note.title, "New");
        assert_eq!(note.content, "Content");
        assert_eq!(note.tags, ["auth"]);
        assert_eq!(note.updated_at, at("2026-07-25T10:00:00.000Z"));
        assert_eq!(note.created_at, now());
    }

    #[test]
    fn a_patch_normalizes_the_tags_it_replaces() {
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
    fn a_checklist_is_not_given_a_guessed_language() {
        let draft = NoteDraft {
            kind: NoteKind::Checklist,
            content: "{ \"a\": 1 }".to_string(),
            language: Language::Txt,
            ..draft(Language::Txt, String::new().as_str())
        };

        let note = draft.into_note("n-2".to_string(), now());

        assert_eq!(note.language, Language::Txt);
    }

    #[test]
    fn turning_a_note_into_a_checklist_does_not_trigger_a_detection() {
        let mut note = Note {
            language: Language::Txt,
            content: String::new(),
            ..sample()
        };
        let patch = NotePatch {
            kind: Some(NoteKind::Checklist),
            content: Some("{ \"a\": 1 }".to_string()),
            ..NotePatch::default()
        };

        patch.apply(&mut note, now());

        assert_eq!(note.language, Language::Txt);
    }

    #[test]
    fn a_patch_replaces_the_whole_item_list_and_normalizes_it() {
        let mut note = Note {
            items: vec![ChecklistItem {
                text: "Old".to_string(),
                done: true,
            }],
            ..sample()
        };
        let patch = NotePatch {
            items: Some(vec![
                ChecklistItem {
                    text: "  Ship it ".to_string(),
                    done: false,
                },
                ChecklistItem {
                    text: "   ".to_string(),
                    done: false,
                },
            ]),
            ..NotePatch::default()
        };

        patch.apply(&mut note, now());

        assert_eq!(
            note.items,
            [ChecklistItem {
                text: "Ship it".to_string(),
                done: false
            }]
        );
    }

    #[test]
    fn a_patch_that_says_nothing_about_the_items_leaves_them_alone() {
        let mut note = Note {
            items: vec![ChecklistItem {
                text: "Ship it".to_string(),
                done: true,
            }],
            ..sample()
        };

        NotePatch {
            title: Some("T".to_string()),
            ..NotePatch::default()
        }
        .apply(&mut note, now());

        assert_eq!(note.items.len(), 1);
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

        assert!(matches!(footer_of(&note), NoteFooter::Expiry { .. }));
    }

    #[test]
    fn a_permanent_note_never_counts_as_expiring_soon() {
        assert!(!expires_soon(&sample(), now()));
    }

    #[test]
    fn the_threshold_is_measured_in_fractions_of_a_day() {
        assert!(!expires_soon(&expiring("2026-07-28T10:00:00.000Z"), now()));
        assert!(expires_soon(&expiring("2026-07-28T08:00:00.000Z"), now()));
    }

    #[test]
    fn an_already_expired_note_counts_as_expiring_soon() {
        assert!(expires_soon(&expiring("2026-07-01T00:00:00.000Z"), now()));
    }
}
