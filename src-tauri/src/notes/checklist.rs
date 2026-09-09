//! What a todo-list note is made of: its [`NoteKind`] and its [`ChecklistItem`]s.
//!
//! [`normalize_items`] is to a checklist what `model::normalize_tags` is to
//! tags — one rule, applied on write and nowhere else. The store receives items
//! already normalized and stays pure SQL.
//!
//! A checklist note carries **no content**: the list replaces the body. That is
//! why `to_markdown` lives here — sharing or copying such a note has to render
//! something, and an empty fenced block would be a useless paste.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use specta::Type;

/// **Closed** list, like `Language`: the front end receives it as a generated
/// TypeScript union, so an unknown value stops compiling there rather than
/// being refused at runtime.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    /// The ordinary note: a title and a coloured body. Default, and what every
    /// note written before todo-lists existed reads back as.
    #[default]
    Snippet,
    /// A todo list: no body, an ordered list of items instead.
    Checklist,
}

impl NoteKind {
    pub const ALL: [Self; 2] = [Self::Snippet, Self::Checklist];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Snippet => "snippet",
            Self::Checklist => "checklist",
        }
    }
}

impl fmt::Display for NoteKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// `notes.kind` carries no `CHECK`, for the same reason `notes.language` does
/// not: a database written by a newer version may hold a kind this one has
/// never heard of, and falling back beats failing the read.
impl FromStr for NoteKind {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
            .ok_or(())
    }
}

/// One line of a todo list. No identifier: the position **is** the identity —
/// `note_items` is keyed on `(note_id, position)` and a write rewrites the whole
/// list, exactly like `note_tags`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub text: String,
    pub done: bool,
}

/// Trims, and drops the blank lines.
///
/// No de-duplication, unlike tags: two identical tasks are two tasks, and
/// silently merging them would lose one. The editor keeps a trailing empty row
/// to type into, which is precisely what must not reach the database.
pub fn normalize_items(items: &[ChecklistItem]) -> Vec<ChecklistItem> {
    items
        .iter()
        .filter_map(|item| {
            let text = item.text.trim();
            (!text.is_empty()).then(|| ChecklistItem {
                text: text.to_string(),
                done: item.done,
            })
        })
        .collect()
}

/// `(done, total)`. `u32` rather than `usize`: Specta refuses to export the
/// latter, and no list is going to overflow it.
pub fn progress(items: &[ChecklistItem]) -> (u32, u32) {
    let done = items.iter().filter(|item| item.done).count();

    (count(done), count(items.len()))
}

/// GitHub-flavoured task list — what a checklist has to look like once pasted
/// into a ticket or a message.
pub fn to_markdown(items: &[ChecklistItem]) -> String {
    items
        .iter()
        .map(|item| format!("- [{}] {}", if item.done { 'x' } else { ' ' }, item.text))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Saturates rather than wrapping: a truncated count would be worse than a
/// capped one, and neither is reachable in practice.
fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(text: &str, done: bool) -> ChecklistItem {
        ChecklistItem {
            text: text.to_string(),
            done,
        }
    }

    #[test]
    fn the_serialised_form_matches_the_stored_one() {
        for kind in NoteKind::ALL {
            let json = serde_json::to_string(&kind).unwrap();

            assert_eq!(json, format!("\"{}\"", kind.as_str()));
            assert_eq!(kind.as_str().parse::<NoteKind>().unwrap(), kind);
        }
    }

    #[test]
    fn an_unknown_stored_kind_is_refused_rather_than_guessed() {
        assert!("kanban".parse::<NoteKind>().is_err());
    }

    #[test]
    fn a_note_written_before_todo_lists_reads_back_as_a_snippet() {
        assert_eq!(NoteKind::default(), NoteKind::Snippet);
    }

    #[test]
    fn normalising_trims_and_drops_the_blank_rows() {
        let items = normalize_items(&[
            item("  Ship it  ", true),
            item("   ", false),
            item("", true),
        ]);

        assert_eq!(items, [item("Ship it", true)]);
    }

    #[test]
    fn two_identical_tasks_are_two_tasks() {
        let items = normalize_items(&[item("Call back", false), item("Call back", false)]);

        assert_eq!(items.len(), 2);
    }

    #[test]
    fn normalising_keeps_the_order_it_was_given() {
        let items = normalize_items(&[item("b", false), item("a", false), item("c", false)]);

        assert_eq!(
            items.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(),
            ["b", "a", "c"]
        );
    }

    #[test]
    fn progress_counts_what_is_ticked() {
        let items = [item("a", true), item("b", false), item("c", true)];

        assert_eq!(progress(&items), (2, 3));
    }

    #[test]
    fn an_empty_list_has_no_progress_rather_than_being_complete() {
        assert_eq!(progress(&[]), (0, 0));
    }

    #[test]
    fn markdown_marks_the_ticked_boxes() {
        let markdown = to_markdown(&[item("Ship it", true), item("Write it up", false)]);

        assert_eq!(markdown, "- [x] Ship it\n- [ ] Write it up");
    }

    #[test]
    fn an_empty_list_renders_to_nothing_at_all() {
        assert_eq!(to_markdown(&[]), "");
    }
}
