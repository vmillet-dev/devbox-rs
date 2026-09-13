//! The side tables a note owns: its tags, its checklist items, its `{{field}}`
//! values. All three are keyed on `note_id` and rewritten whole rather than patched
//! — the row set *is* the value — so all three read, replace and bulk-load the same
//! way. A fourth would follow the same three functions.

use std::collections::{BTreeMap, HashMap};

use diesel::prelude::*;

use super::notes_of_space;
use crate::db::schema::{note_items, note_placeholders, note_tags};
use crate::error::StorageError;
use crate::notes::checklist::ChecklistItem;
use crate::notes::model::Note;

/// ⚠️ Narrowed by **subquery**, not by a list of bound ids: binding one
/// parameter per note costs more than the read itself past a few thousand notes.
/// Reading a superset is harmless — `attach_related` only looks up what it holds.
pub fn all_tags(
    connection: &mut SqliteConnection,
    space_id: Option<&str>,
) -> Result<HashMap<String, Vec<String>>, StorageError> {
    let mut query = note_tags::table
        .select((note_tags::note_id, note_tags::tag))
        .order(note_tags::tag.asc())
        .into_boxed();

    if let Some(space_id) = space_id {
        query = query.filter(note_tags::note_id.eq_any(notes_of_space(space_id)));
    }

    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();
    for (note_id, tag) in query.load::<(String, String)>(connection)? {
        grouped.entry(note_id).or_default().push(tag);
    }

    Ok(grouped)
}

pub fn tags_of(
    connection: &mut SqliteConnection,
    note_id: &str,
) -> Result<Vec<String>, StorageError> {
    Ok(note_tags::table
        .filter(note_tags::note_id.eq(note_id))
        .select(note_tags::tag)
        .order(note_tags::tag.asc())
        .load::<String>(connection)?)
}

/// ⚠️ Re-read rather than sorted: `note_tags.tag` is `COLLATE NOCASE` and a read
/// orders in that collation, which a byte-wise `sort()` does not reproduce.
pub fn replace_tags(
    connection: &mut SqliteConnection,
    note_id: &str,
    tags: &[String],
) -> Result<Vec<String>, StorageError> {
    diesel::delete(note_tags::table.filter(note_tags::note_id.eq(note_id))).execute(connection)?;

    if !tags.is_empty() {
        let rows: Vec<_> = tags
            .iter()
            .map(|tag| (note_tags::note_id.eq(note_id), note_tags::tag.eq(tag)))
            .collect();
        diesel::insert_or_ignore_into(note_tags::table)
            .values(rows)
            .execute(connection)?;
    }

    tags_of(connection, note_id)
}

pub fn all_items(
    connection: &mut SqliteConnection,
    space_id: Option<&str>,
) -> Result<HashMap<String, Vec<ChecklistItem>>, StorageError> {
    let mut query = note_items::table
        .select((note_items::note_id, note_items::text, note_items::done))
        .order((note_items::note_id.asc(), note_items::position.asc()))
        .into_boxed();

    if let Some(space_id) = space_id {
        query = query.filter(note_items::note_id.eq_any(notes_of_space(space_id)));
    }

    let mut grouped: HashMap<String, Vec<ChecklistItem>> = HashMap::new();
    for (note_id, text, done) in query.load::<(String, String, bool)>(connection)? {
        grouped
            .entry(note_id)
            .or_default()
            .push(ChecklistItem { text, done });
    }

    Ok(grouped)
}

pub fn items_of(
    connection: &mut SqliteConnection,
    note_id: &str,
) -> Result<Vec<ChecklistItem>, StorageError> {
    Ok(note_items::table
        .filter(note_items::note_id.eq(note_id))
        .select((note_items::text, note_items::done))
        .order(note_items::position.asc())
        .load::<(String, bool)>(connection)?
        .into_iter()
        .map(|(text, done)| ChecklistItem { text, done })
        .collect())
}

/// Wiped then reinserted: the position is part of the key, so reordering would
/// otherwise move rows one at a time under a key that refuses duplicates.
pub fn replace_items(
    connection: &mut SqliteConnection,
    note_id: &str,
    items: &[ChecklistItem],
) -> Result<(), StorageError> {
    diesel::delete(note_items::table.filter(note_items::note_id.eq(note_id)))
        .execute(connection)?;

    if !items.is_empty() {
        let rows: Vec<_> = items
            .iter()
            .enumerate()
            .map(|(position, item)| {
                (
                    note_items::note_id.eq(note_id),
                    note_items::position.eq(i32::try_from(position).unwrap_or(i32::MAX)),
                    note_items::text.eq(&item.text),
                    note_items::done.eq(item.done),
                )
            })
            .collect();
        diesel::insert_into(note_items::table)
            .values(rows)
            .execute(connection)?;
    }

    Ok(())
}
pub fn attach_related(
    connection: &mut SqliteConnection,
    notes: &mut [Note],
    space_id: Option<&str>,
) -> Result<(), StorageError> {
    if notes.is_empty() {
        return Ok(());
    }

    let mut tags = all_tags(connection, space_id)?;
    let mut items = all_items(connection, space_id)?;
    let mut values = all_placeholder_values(connection, space_id)?;

    for note in notes {
        note.tags = tags.remove(&note.id).unwrap_or_default();
        note.items = items.remove(&note.id).unwrap_or_default();
        note.placeholder_values = values.remove(&note.id).unwrap_or_default();
    }

    Ok(())
}

pub fn all_placeholder_values(
    connection: &mut SqliteConnection,
    space_id: Option<&str>,
) -> Result<HashMap<String, BTreeMap<String, String>>, StorageError> {
    let mut query = note_placeholders::table
        .select((
            note_placeholders::note_id,
            note_placeholders::name,
            note_placeholders::value,
        ))
        .into_boxed();

    if let Some(space_id) = space_id {
        query = query.filter(note_placeholders::note_id.eq_any(notes_of_space(space_id)));
    }

    let mut grouped: HashMap<String, BTreeMap<String, String>> = HashMap::new();
    for (note_id, name, value) in query.load::<(String, String, String)>(connection)? {
        grouped.entry(note_id).or_default().insert(name, value);
    }

    Ok(grouped)
}

pub fn placeholder_values_of(
    connection: &mut SqliteConnection,
    note_id: &str,
) -> Result<BTreeMap<String, String>, StorageError> {
    Ok(note_placeholders::table
        .filter(note_placeholders::note_id.eq(note_id))
        .select((note_placeholders::name, note_placeholders::value))
        .load::<(String, String)>(connection)?
        .into_iter()
        .collect())
}

pub fn replace_placeholder_values(
    connection: &mut SqliteConnection,
    note_id: &str,
    values: &BTreeMap<String, String>,
) -> Result<(), StorageError> {
    diesel::delete(note_placeholders::table.filter(note_placeholders::note_id.eq(note_id)))
        .execute(connection)?;

    if !values.is_empty() {
        let rows: Vec<_> = values
            .iter()
            .map(|(name, value)| {
                (
                    note_placeholders::note_id.eq(note_id),
                    note_placeholders::name.eq(name),
                    note_placeholders::value.eq(value),
                )
            })
            .collect();
        diesel::insert_into(note_placeholders::table)
            .values(rows)
            .execute(connection)?;
    }

    Ok(())
}
