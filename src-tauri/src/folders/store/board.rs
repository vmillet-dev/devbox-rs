//! The geometry, which is the half of a folder that does not travel. Same split as
//! `notes::store::trash` beside `notes::trash`: the rules are in `folders::board`, this is
//! only the SQL that stores and reads them.

use std::collections::HashMap;

use diesel::prelude::*;

use crate::db::Library;
use crate::db::schema::{folders, note_positions, notes};
use crate::error::StorageError;
use crate::folders::board::{BoardFrame, BoardPoint};

/// What a board read resolves before anything can be drawn: where each zone sits, and
/// where each loose card does.
pub type Geometry = (HashMap<String, BoardFrame>, HashMap<String, BoardPoint>);

/// A folder never laid out answers `None` — all four columns move together.
pub fn frames(
    connection: &mut SqliteConnection,
    space_id: &str,
) -> Result<HashMap<String, BoardFrame>, StorageError> {
    let rows = folders::table
        .filter(folders::space_id.eq(space_id))
        .select((folders::id, folders::x, folders::y, folders::w, folders::h))
        .load::<(String, Option<i32>, Option<i32>, Option<i32>, Option<i32>)>(connection)?;

    Ok(rows
        .into_iter()
        .filter_map(|(id, x, y, width, height)| {
            Some((
                id,
                BoardFrame {
                    x: x?,
                    y: y?,
                    width: width?,
                    height: height?,
                },
            ))
        })
        .collect())
}

pub fn set_frame(
    connection: &mut SqliteConnection,
    folder_id: &str,
    frame: BoardFrame,
) -> Result<(), StorageError> {
    diesel::update(folders::table.find(folder_id))
        .set((
            folders::x.eq(frame.x),
            folders::y.eq(frame.y),
            folders::w.eq(frame.width),
            folders::h.eq(frame.height),
        ))
        .execute(connection)?;

    Ok(())
}

/// ⚠️ Narrowed by subquery, not by a list of bound ids — the rule every side table here
/// follows. Reading a superset is harmless: the caller only looks up the notes it holds.
pub fn positions(
    connection: &mut SqliteConnection,
    space_id: &str,
) -> Result<HashMap<String, BoardPoint>, StorageError> {
    let rows = note_positions::table
        .filter(
            note_positions::note_id.eq_any(
                notes::table
                    .select(notes::id)
                    .filter(notes::space_id.eq(space_id.to_string())),
            ),
        )
        .select((
            note_positions::note_id,
            note_positions::x,
            note_positions::y,
        ))
        .load::<(String, i32, i32)>(connection)?;

    Ok(rows
        .into_iter()
        .map(|(note_id, x, y)| (note_id, BoardPoint { x, y }))
        .collect())
}

pub fn set_position(
    connection: &mut SqliteConnection,
    note_id: &str,
    point: BoardPoint,
) -> Result<(), StorageError> {
    diesel::replace_into(note_positions::table)
        .values((
            note_positions::note_id.eq(note_id),
            note_positions::x.eq(point.x),
            note_positions::y.eq(point.y),
        ))
        .execute(connection)?;

    Ok(())
}

/// ⚠️ A row exists only for a loose note, so filing one into a zone drops it: a filed card
/// flows inside its zone and has no position of its own to keep consistent.
pub fn forget_positions(
    connection: &mut SqliteConnection,
    note_ids: &[String],
) -> Result<(), StorageError> {
    if note_ids.is_empty() {
        return Ok(());
    }

    diesel::delete(note_positions::table.filter(note_positions::note_id.eq_any(note_ids)))
        .execute(connection)?;

    Ok(())
}

/// Reads the geometry, filling in whatever has never been laid out, in one transaction.
///
/// ⚠️ A read that writes, deliberately: every folder and every loose note needs a first
/// position, and computing one on the fly without storing it would let the very first drag
/// land next to cards that have no stored place of their own. It is idempotent — the
/// second board read of a space writes nothing.
pub fn geometry<S: std::hash::BuildHasher>(
    connection: &mut Library,
    space_id: &str,
    folder_ids: &[String],
    note_counts: &HashMap<String, usize, S>,
    loose_ids: &[String],
) -> Result<Geometry, StorageError> {
    use crate::folders::board;

    connection.transaction(|connection, _vault| {
        let mut stored_frames = frames(connection, space_id)?;
        let mut stored_positions = positions(connection, space_id)?;

        let missing: Vec<&String> = folder_ids
            .iter()
            .filter(|id| !stored_frames.contains_key(*id))
            .collect();

        if !missing.is_empty() {
            // ⚠️ Arranged against *every* folder, not just the unplaced ones, so a folder
            // added later lands in the slot reading order gives it rather than on top of
            // the first zone.
            let counts: Vec<usize> = folder_ids
                .iter()
                .map(|id| note_counts.get(id).copied().unwrap_or(0))
                .collect();
            let arranged = board::arrange_zones(&counts);

            for (id, frame) in folder_ids.iter().zip(arranged) {
                if stored_frames.contains_key(id) {
                    continue;
                }
                set_frame(connection, id, frame)?;
                stored_frames.insert(id.clone(), frame);
            }
        }

        let unplaced: Vec<&String> = loose_ids
            .iter()
            .filter(|id| !stored_positions.contains_key(*id))
            .collect();

        if !unplaced.is_empty() {
            let top = board::loose_top(&stored_frames.values().copied().collect::<Vec<_>>());
            let points = board::arrange_loose(loose_ids.len(), top);

            for (id, point) in loose_ids.iter().zip(points) {
                if stored_positions.contains_key(id) {
                    continue;
                }
                set_position(connection, id, point)?;
                stored_positions.insert(id.clone(), point);
            }
        }

        Ok((stored_frames, stored_positions))
    })
}
