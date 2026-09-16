//! The board: a second way to look at one space, where a folder is a region drawn on a
//! free canvas and its notes sit inside it.
//!
//! ⚠️ A query of its own rather than a bent [`crate::notes::view::NotesQuery`]: it answers
//! folders and positions, not sections, and `build_sections` must never learn about a
//! folder. What the two share is the coarse filtering, which happens in SQL either way.
//!
//! This module imports neither Diesel nor Tauri, so the layout rules are tested without
//! opening a database.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::model::Folder;
use crate::count::saturating_u32;
use crate::notes::language::Language;
use crate::notes::model::{self, DisplayNote, Note, NoteLifecycle};
use crate::notes::view::{self, Facets, NoteFilter};

/// The card is the same card as on the canvas — full size, with its language tag, its
/// snippet, its footer and its tags. The consequence is accepted: the board is large, and
/// panning arrives with it.
pub const CARD_WIDTH: i32 = 240;
/// Nominal: a real card grows with its content, and only the *first* frame is computed
/// from this. Once a zone has been resized the stored size is what counts.
pub const CARD_HEIGHT: i32 = 150;
pub const GAP: i32 = 12;
pub const ZONE_PADDING: i32 = 12;
/// The title, the count and the ⋯ trigger.
pub const ZONE_HEADER: i32 = 38;
/// How many cards a freshly drawn zone is wide.
pub const ZONE_COLUMNS: i32 = 2;
/// A zone with no note is still a target to drop one into.
pub const MIN_ZONE_ROWS: i32 = 1;
/// How many zones sit side by side before the first layout wraps.
pub const BOARD_COLUMNS: i32 = 3;
pub const BOARD_MARGIN: i32 = 16;
/// How many loose cards sit side by side under the zones.
pub const LOOSE_COLUMNS: i32 = 4;
/// Room for the "no folder · N" label above the loose cards.
pub const LOOSE_LABEL: i32 = 34;

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardQuery {
    /// Required, unlike [`crate::notes::view::NotesQuery::space_id`]: a folder belongs to
    /// a space, so a board across all of them would have no zones to draw.
    pub space_id: String,
    pub search: String,
    pub filter: NoteFilter,
    pub tags: Vec<String>,
    pub languages: Vec<Language>,
    pub now: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardFrame {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardPoint {
    pub x: i32,
    pub y: i32,
}

/// `flatten`: the front end draws this with the same card component the canvas uses.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardNote {
    #[serde(flatten)]
    pub note: DisplayNote,
    /// ⚠️ Dimmed in place rather than reflowed into a list: spatial memory is the only
    /// thing the board has that the date view does not, and a reflow throws it away.
    pub matches: bool,
    /// `None` inside a zone, where a card flows; `Some` only on the free background.
    pub position: Option<BoardPoint>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardZone {
    pub folder: Folder,
    pub frame: BoardFrame,
    pub notes: Vec<BoardNote>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    pub zones: Vec<BoardZone>,
    pub loose: Vec<BoardNote>,
    /// Attached to the space, like [`crate::notes::view::NotesView`]'s: facets drawn from
    /// already filtered notes would empty the rails on the first selection.
    pub available_tags: Vec<String>,
    pub available_languages: Vec<Language>,
    pub is_filtering: bool,
    pub matched: u32,
    /// The surface to pan over, so the front end sizes it from what is actually on it.
    pub width: i32,
    pub height: i32,
}

/// The width every zone gets on its first layout: [`ZONE_COLUMNS`] cards and the gaps.
#[must_use]
pub fn default_zone_width() -> i32 {
    ZONE_PADDING * 2 + ZONE_COLUMNS * CARD_WIDTH + (ZONE_COLUMNS - 1) * GAP
}

/// Tall enough for the notes it already holds, and never shorter than one row — an empty
/// zone is still somewhere to drop a card.
#[must_use]
pub fn default_zone_height(note_count: usize) -> i32 {
    let columns = ZONE_COLUMNS.max(1);
    let notes = i32::try_from(note_count).unwrap_or(i32::MAX);
    let rows = notes.div_euclid(columns) + i32::from(notes.rem_euclid(columns) != 0);

    let rows = rows.max(MIN_ZONE_ROWS);
    ZONE_HEADER + ZONE_PADDING + rows * CARD_HEIGHT + (rows - 1) * GAP + ZONE_PADDING
}

/// Lays zones out in reading order, wrapping every [`BOARD_COLUMNS`].
///
/// ⚠️ Deterministic and driven only by the order it is handed: the board would look
/// shuffled at every launch otherwise, and the caller reads folders in `created_at` order
/// for exactly that reason.
#[must_use]
pub fn arrange_zones(note_counts: &[usize]) -> Vec<BoardFrame> {
    let width = default_zone_width();
    let columns = usize::try_from(BOARD_COLUMNS).unwrap_or(1).max(1);

    let mut frames: Vec<BoardFrame> = Vec::with_capacity(note_counts.len());
    let mut row_top = BOARD_MARGIN;
    let mut row_height = 0;

    for (index, count) in note_counts.iter().enumerate() {
        let column = index % columns;
        if column == 0 && index > 0 {
            row_top += row_height + GAP;
            row_height = 0;
        }

        let height = default_zone_height(*count);
        row_height = row_height.max(height);

        frames.push(BoardFrame {
            x: BOARD_MARGIN + i32::try_from(column).unwrap_or(0) * (width + GAP),
            y: row_top,
            width,
            height,
        });
    }

    frames
}

/// Where the loose cards start: under the lowest zone, with room for their label.
#[must_use]
pub fn loose_top(frames: &[BoardFrame]) -> i32 {
    frames
        .iter()
        .map(|frame| frame.y + frame.height)
        .max()
        .map_or(BOARD_MARGIN, |bottom| bottom + GAP * 2)
        + LOOSE_LABEL
}

/// Flows loose cards left to right under the zones, wrapping every [`LOOSE_COLUMNS`].
#[must_use]
pub fn arrange_loose(count: usize, top: i32) -> Vec<BoardPoint> {
    let columns = usize::try_from(LOOSE_COLUMNS).unwrap_or(1).max(1);

    (0..count)
        .map(|index| BoardPoint {
            x: BOARD_MARGIN + i32::try_from(index % columns).unwrap_or(0) * (CARD_WIDTH + GAP),
            y: top + i32::try_from(index / columns).unwrap_or(0) * (CARD_HEIGHT + GAP),
        })
        .collect()
}

/// The surface to pan over: whatever the furthest zone or card reaches, plus a margin, and
/// never smaller than one screen's worth — a board holding one zone should still feel like
/// a canvas.
#[must_use]
pub fn surface(zones: &[BoardZone], loose: &[BoardNote]) -> (i32, i32) {
    const MIN_WIDTH: i32 = 960;
    const MIN_HEIGHT: i32 = 540;

    let mut right = MIN_WIDTH;
    let mut bottom = MIN_HEIGHT;

    for zone in zones {
        right = right.max(zone.frame.x + zone.frame.width);
        bottom = bottom.max(zone.frame.y + zone.frame.height);
    }
    for note in loose {
        if let Some(position) = note.position {
            right = right.max(position.x + CARD_WIDTH);
            bottom = bottom.max(position.y + CARD_HEIGHT);
        }
    }

    (right + BOARD_MARGIN, bottom + BOARD_MARGIN)
}

/// What a board is showing, and what it is merely dimming.
///
/// ⚠️ Nothing is dropped: the quick filter, the tag rail, the language rail and the search
/// all decide  rather than membership. Reflowing the survivors into a list would
/// throw away the spatial memory the board exists for.
#[must_use]
pub fn matches(note: &Note, needle: &str, request: &BoardQuery) -> bool {
    let passes_filter = match request.filter {
        NoteFilter::All => true,
        NoteFilter::Pinned => note.pinned,
        NoteFilter::Untriaged => matches!(note.lifecycle, NoteLifecycle::Expires { .. }),
    };

    let passes_tags = request.tags.is_empty()
        || request.tags.iter().any(|wanted| {
            note.tags
                .iter()
                .any(|carried| carried.to_lowercase() == wanted.to_lowercase())
        });

    let passes_languages =
        request.languages.is_empty() || request.languages.contains(&note.language);

    let passes_search = needle.is_empty() || view::matches_search(note, needle);

    passes_filter && passes_tags && passes_languages && passes_search
}

/// Pinned first, then by when they last moved — the order the canvas gives them, kept so a
/// note does not sit in one place on one view and another on the other.
fn in_zone_order(notes: &mut [BoardNote]) {
    notes.sort_by_key(|entry| !entry.note.pinned);
}

/// Assembles what the command read. Reads no database: the geometry arrives already
/// resolved, and so does the decoration that needs a connection.
#[must_use]
pub fn build<S: std::hash::BuildHasher>(
    notes: Vec<Note>,
    folders: Vec<Folder>,
    frames: &HashMap<String, BoardFrame, S>,
    positions: &HashMap<String, BoardPoint, S>,
    facets: Facets,
    request: &BoardQuery,
) -> BoardView {
    let needle = view::fold(request.search.trim());

    let mut by_folder: HashMap<String, Vec<BoardNote>> = HashMap::new();
    let mut loose: Vec<BoardNote> = Vec::new();
    let mut matched = 0usize;

    for note in notes {
        let hit = matches(&note, &needle, request);
        matched += usize::from(hit);

        let folder_id = note.folder_id.clone();
        let entry = BoardNote {
            note: model::decorate(note, request.now),
            matches: hit,
            position: None,
        };

        match folder_id {
            Some(id) => by_folder.entry(id).or_default().push(entry),
            None => loose.push(entry),
        }
    }

    for entry in &mut loose {
        entry.position = positions.get(&entry.note.id).copied();
    }

    let placed = frames.values().copied().collect::<Vec<_>>();
    let fallback_top = loose_top(&placed);

    let zones: Vec<BoardZone> = folders
        .into_iter()
        .map(|folder| {
            let mut notes = by_folder.remove(&folder.id).unwrap_or_default();
            in_zone_order(&mut notes);

            let frame = frames.get(&folder.id).copied().unwrap_or(BoardFrame {
                x: BOARD_MARGIN,
                y: BOARD_MARGIN,
                width: default_zone_width(),
                height: default_zone_height(notes.len()),
            });

            BoardZone {
                folder,
                frame,
                notes,
            }
        })
        .collect();

    // A loose note with no stored place is one the geometry pass has not seen yet — it is
    // put somewhere legible rather than stacked at the origin.
    let mut spare = 0usize;
    for entry in &mut loose {
        if entry.position.is_none() {
            entry.position = arrange_loose(spare + 1, fallback_top).pop();
            spare += 1;
        }
    }

    let is_filtering = !needle.is_empty()
        || request.filter != NoteFilter::All
        || !request.tags.is_empty()
        || !request.languages.is_empty();

    let (width, height) = surface(&zones, &loose);

    BoardView {
        zones,
        loose,
        available_tags: facets.tags,
        available_languages: facets.languages,
        is_filtering,
        matched: saturating_u32(matched),
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zone_is_two_cards_wide_whatever_it_holds() {
        assert_eq!(default_zone_width(), 12 + 240 + 12 + 240 + 12);
    }

    #[test]
    fn a_zone_grows_a_row_at_a_time() {
        let one_row = default_zone_height(2);
        let two_rows = default_zone_height(3);

        assert_eq!(two_rows - one_row, CARD_HEIGHT + GAP);
        assert_eq!(default_zone_height(4), two_rows);
    }

    /// A zone with nothing in it is still a target to drop a card into.
    #[test]
    fn an_empty_zone_is_still_a_row_tall() {
        assert_eq!(default_zone_height(0), default_zone_height(1));
    }

    #[test]
    fn zones_are_laid_out_in_reading_order() {
        let frames = arrange_zones(&[1, 1, 1]);

        assert_eq!(frames[0].y, frames[1].y);
        assert!(frames[0].x < frames[1].x);
        assert!(frames[1].x < frames[2].x);
    }

    #[test]
    fn the_layout_wraps_after_three_zones() {
        let frames = arrange_zones(&[1, 1, 1, 1]);

        assert_eq!(frames[3].x, frames[0].x);
        assert!(frames[3].y > frames[0].y);
    }

    /// ⚠️ A row advances by its tallest zone, or the next row lands on top of it.
    #[test]
    fn a_wrapped_row_clears_the_tallest_zone_above_it() {
        let frames = arrange_zones(&[1, 9, 1, 1]);

        let tallest = frames[..3].iter().map(|f| f.y + f.height).max().unwrap();
        assert!(frames[3].y >= tallest);
    }

    /// The same board twice is the same board: it must not look shuffled at every launch.
    #[test]
    fn the_layout_is_the_same_every_time() {
        assert_eq!(arrange_zones(&[3, 1, 7]), arrange_zones(&[3, 1, 7]));
    }

    #[test]
    fn loose_cards_flow_under_the_zones_with_room_for_their_label() {
        let frames = arrange_zones(&[1]);
        let top = loose_top(&frames);

        assert!(top > frames[0].y + frames[0].height);

        let points = arrange_loose(5, top);
        assert_eq!(
            points[0],
            BoardPoint {
                x: BOARD_MARGIN,
                y: top
            }
        );
        assert_eq!(points[3].y, top);
        assert_eq!(points[4].x, BOARD_MARGIN);
        assert_eq!(points[4].y, top + CARD_HEIGHT + GAP);
    }

    #[test]
    fn an_empty_board_still_puts_its_loose_cards_somewhere() {
        assert_eq!(loose_top(&[]), BOARD_MARGIN + LOOSE_LABEL);
    }

    #[test]
    fn the_surface_covers_the_furthest_zone() {
        let zone = BoardZone {
            folder: crate::folders::model::Folder {
                id: "f-1".to_string(),
                space_id: "s-1".to_string(),
                name: "Perf".to_string(),
                colour: crate::folders::model::FolderColour::Blue,
                created_at: Utc::now(),
            },
            frame: BoardFrame {
                x: 2000,
                y: 1500,
                width: 300,
                height: 200,
            },
            notes: Vec::new(),
        };

        let (width, height) = surface(std::slice::from_ref(&zone), &[]);

        assert_eq!(width, 2300 + BOARD_MARGIN);
        assert_eq!(height, 1700 + BOARD_MARGIN);
    }

    /// A board holding one small zone should still feel like a canvas.
    #[test]
    fn the_surface_is_never_smaller_than_a_screen() {
        let (width, height) = surface(&[], &[]);

        assert!(width >= 960);
        assert!(height >= 540);
    }
}
