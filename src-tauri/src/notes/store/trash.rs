//! The trash's SQL. The retention itself, and what a purge does to the attachment
//! files, live in `notes::trash` — this module only knows that `deleted_at` decides.
//!
//! ⚠️ Every read elsewhere filters on `deleted_at IS NULL`, or a trashed note comes
//! back editable without saying it is on borrowed time.

use chrono::{DateTime, Utc};
use diesel::prelude::*;

use super::{NoteRow, related};
use crate::db::iso8601;
use crate::db::schema::notes;
use crate::error::StorageError;
use crate::notes::model::Note;
use crate::notes::trash;

/// ⚠️ Stamps `deleted_at`; the row survives for [`trash::RETENTION`]. [`purge`] is
/// what erases — `delete` was the same word `spaces::store` and `attachments::store`
/// use for an irreversible one.
pub fn trash(
    connection: &mut SqliteConnection,
    id: &str,
    now: DateTime<Utc>,
) -> Result<(), StorageError> {
    if trash_many(connection, std::slice::from_ref(&id.to_string()), now)? == 0 {
        return Err(StorageError::NoteNotFound(id.to_string()));
    }

    Ok(())
}

/// Returns what was actually moved: a selection can hold an id gone stale, and
/// failing the whole batch for one of them would be worse than a partial result.
pub fn trash_many(
    connection: &mut SqliteConnection,
    ids: &[String],
    now: DateTime<Utc>,
) -> Result<usize, StorageError> {
    if ids.is_empty() {
        return Ok(0);
    }

    Ok(diesel::update(
        notes::table
            .filter(notes::id.eq_any(ids))
            .filter(notes::deleted_at.is_null()),
    )
    .set(notes::deleted_at.eq(iso8601::format(now)))
    .execute(connection)?)
}

/// `updated_at` is not touched: the note comes back where it was.
pub fn restore_many(
    connection: &mut SqliteConnection,
    ids: &[String],
) -> Result<usize, StorageError> {
    if ids.is_empty() {
        return Ok(0);
    }

    Ok(diesel::update(
        notes::table
            .filter(notes::id.eq_any(ids))
            .filter(notes::deleted_at.is_not_null()),
    )
    .set(notes::deleted_at.eq(None::<String>))
    .execute(connection)?)
}

pub fn list_trashed(
    connection: &mut SqliteConnection,
) -> Result<Vec<(Note, DateTime<Utc>)>, StorageError> {
    let rows = notes::table
        .filter(notes::deleted_at.is_not_null())
        .select((NoteRow::as_select(), notes::deleted_at))
        .order((notes::deleted_at.desc(), notes::id.asc()))
        .load::<(NoteRow, Option<String>)>(connection)?;

    let mut grouped = related::all_tags(connection, None)?;
    rows.into_iter()
        .map(|(row, deleted_at)| {
            let id = row.id.clone();
            let raw = deleted_at.unwrap_or_default();
            let deleted_at = iso8601::parse(&raw).map_err(|_| StorageError::CorruptRow {
                id: id.clone(),
                field: "deletedAt",
            })?;

            Ok((
                Note {
                    tags: grouped.remove(&id).unwrap_or_default(),
                    ..Note::try_from(row)?
                },
                deleted_at,
            ))
        })
        .collect()
}

/// Separate from [`purge`] so the caller can erase the attached files first.
pub fn expired_ids(
    connection: &mut SqliteConnection,
    now: DateTime<Utc>,
) -> Result<Vec<String>, StorageError> {
    let rows = notes::table
        .filter(notes::deleted_at.is_not_null())
        .select((notes::id, notes::deleted_at))
        .load::<(String, Option<String>)>(connection)?;

    Ok(rows
        .into_iter()
        .filter_map(|(id, deleted_at)| {
            let deleted_at = iso8601::parse(&deleted_at?).ok()?;
            trash::is_expired(deleted_at, now).then_some(id)
        })
        .collect())
}

pub fn trashed_ids(connection: &mut SqliteConnection) -> Result<Vec<String>, StorageError> {
    Ok(notes::table
        .filter(notes::deleted_at.is_not_null())
        .select(notes::id)
        .load::<String>(connection)?)
}

/// **Permanent**. Tags and attachments leave by cascade — hence the
/// `PRAGMA foreign_keys` in `db::configure`; the files on disk are the caller's.
/// Restricted to trashed notes: nothing may short-circuit the 30-day reprieve.
pub fn purge(connection: &mut SqliteConnection, ids: &[String]) -> Result<usize, StorageError> {
    if ids.is_empty() {
        return Ok(0);
    }

    Ok(diesel::delete(
        notes::table
            .filter(notes::id.eq_any(ids))
            .filter(notes::deleted_at.is_not_null()),
    )
    .execute(connection)?)
}
