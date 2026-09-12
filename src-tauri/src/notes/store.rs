use std::collections::{BTreeMap, HashMap};

use diesel::prelude::*;
use uuid::Uuid;

use chrono::{DateTime, Utc};

use super::checklist::{self, ChecklistItem};
use super::model::{self, Note, NoteDraft, NoteLifecycle, NotePatch};
use super::placeholder;
use super::trash;
use super::view::{Facets, NoteFilter, NotesQuery};
use crate::db::iso8601;
use crate::db::schema::{global_placeholders, note_items, note_placeholders, note_tags, notes};
use crate::error::StorageError;
use crate::spaces::store as spaces;

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = notes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
struct NoteRow {
    id: String,
    space_id: String,
    title: String,
    language: String,
    content: String,
    source: String,
    pinned: bool,
    created_at: String,
    updated_at: String,
    lifecycle_kind: String,
    lifecycle_expires_at: Option<String>,
    kind: String,
}

/// An unreadable date fails the read: these columns are only ever written by
/// [`iso8601::format`]. Language and `kind` fall back to their default instead —
/// a newer version may have written a value this build does not know.
impl TryFrom<NoteRow> for Note {
    type Error = StorageError;

    fn try_from(row: NoteRow) -> Result<Self, Self::Error> {
        let instant = |field: &'static str, value: &str| {
            iso8601::parse(value).map_err(|_| StorageError::CorruptRow {
                id: row.id.clone(),
                field,
            })
        };

        // The schema `CHECK` makes `("expires", None)` unreachable.
        let lifecycle = match (row.lifecycle_kind.as_str(), &row.lifecycle_expires_at) {
            ("expires", Some(at)) => NoteLifecycle::Expires {
                at: instant("lifecycleExpiresAt", at)?,
            },
            _ => NoteLifecycle::Permanent,
        };

        Ok(Self {
            created_at: instant("createdAt", &row.created_at)?,
            updated_at: instant("updatedAt", &row.updated_at)?,
            language: row.language.parse().unwrap_or_default(),
            kind: row.kind.parse().unwrap_or_default(),
            id: row.id,
            space_id: row.space_id,
            title: row.title,
            content: row.content,
            source: row.source,
            tags: Vec::new(),
            items: Vec::new(),
            placeholder_values: BTreeMap::new(),
            pinned: row.pinned,
            lifecycle,
        })
    }
}

impl From<&Note> for NoteRow {
    fn from(note: &Note) -> Self {
        let (lifecycle_kind, lifecycle_expires_at) = match note.lifecycle {
            NoteLifecycle::Permanent => ("permanent", None),
            NoteLifecycle::Expires { at } => ("expires", Some(iso8601::format(at))),
        };

        Self {
            id: note.id.clone(),
            space_id: note.space_id.clone(),
            title: note.title.clone(),
            language: note.language.to_string(),
            content: note.content.clone(),
            source: note.source.clone(),
            pinned: note.pinned,
            created_at: iso8601::format(note.created_at),
            updated_at: iso8601::format(note.updated_at),
            lifecycle_kind: lifecycle_kind.to_string(),
            lifecycle_expires_at,
            kind: note.kind.to_string(),
        }
    }
}

fn notes_of_space(
    space_id: &str,
) -> diesel::helper_types::Filter<
    diesel::helper_types::Select<notes::table, notes::id>,
    diesel::dsl::Eq<notes::space_id, String>,
> {
    notes::table
        .select(notes::id)
        .filter(notes::space_id.eq(space_id.to_string()))
}

/// ⚠️ Narrowed by **subquery**, not by a list of bound ids: binding one
/// parameter per note costs more than the read itself past a few thousand notes.
/// Reading a superset is harmless — `attach_related` only looks up what it holds.
fn all_tags(
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

fn tags_of(connection: &mut SqliteConnection, note_id: &str) -> Result<Vec<String>, StorageError> {
    Ok(note_tags::table
        .filter(note_tags::note_id.eq(note_id))
        .select(note_tags::tag)
        .order(note_tags::tag.asc())
        .load::<String>(connection)?)
}

/// ⚠️ Re-read rather than sorted: `note_tags.tag` is `COLLATE NOCASE` and a read
/// orders in that collation, which a byte-wise `sort()` does not reproduce.
fn replace_tags(
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

fn all_items(
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

fn items_of(
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
fn replace_items(
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
fn attach_related(
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

fn all_placeholder_values(
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

fn placeholder_values_of(
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

fn replace_placeholder_values(
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

pub fn global_placeholder_values(
    connection: &mut SqliteConnection,
) -> Result<BTreeMap<String, String>, StorageError> {
    Ok(global_placeholders::table
        .select((global_placeholders::name, global_placeholders::value))
        .order(global_placeholders::name.asc())
        .load::<(String, String)>(connection)?
        .into_iter()
        .collect())
}

pub fn replace_global_placeholder_values(
    connection: &mut SqliteConnection,
    values: &BTreeMap<String, String>,
) -> Result<(), StorageError> {
    connection.transaction(|connection| {
        diesel::delete(global_placeholders::table).execute(connection)?;

        if !values.is_empty() {
            let rows: Vec<_> = values
                .iter()
                .map(|(name, value)| {
                    (
                        global_placeholders::name.eq(name),
                        global_placeholders::value.eq(value),
                    )
                })
                .collect();
            diesel::insert_into(global_placeholders::table)
                .values(rows)
                .execute(connection)?;
        }

        Ok(())
    })
}

/// Scoped to the space and not to the current filter — see [`NotesView`].
fn facets(
    connection: &mut SqliteConnection,
    space_id: Option<&str>,
) -> Result<Facets, StorageError> {
    let mut tags = note_tags::table
        .inner_join(notes::table)
        .filter(notes::deleted_at.is_null())
        .select(note_tags::tag)
        .distinct()
        .order(note_tags::tag.asc())
        .into_boxed();
    let mut languages = notes::table
        .filter(notes::deleted_at.is_null())
        .select(notes::language)
        .distinct()
        .order(notes::language.asc())
        .into_boxed();

    if let Some(id) = space_id {
        tags = tags.filter(notes::space_id.eq(id.to_string()));
        languages = languages.filter(notes::space_id.eq(id.to_string()));
    }

    Ok(Facets {
        tags: tags.load::<String>(connection)?,
        // A stored language this build does not know has no facet to offer.
        languages: languages
            .load::<String>(connection)?
            .iter()
            .filter_map(|language| language.parse().ok())
            .collect(),
    })
}

/// **Coarse** criteria only; `view::build` takes over for search and sections.
pub fn fetch(
    connection: &mut SqliteConnection,
    request: &NotesQuery,
) -> Result<(Vec<Note>, Facets), StorageError> {
    let mut query = notes::table
        .filter(notes::deleted_at.is_null())
        .select(NoteRow::as_select())
        .into_boxed();

    if let Some(space_id) = &request.space_id {
        query = query.filter(notes::space_id.eq(space_id.clone()));
    }

    match request.filter {
        NoteFilter::All => {}
        NoteFilter::Pinned => query = query.filter(notes::pinned.eq(true)),
        NoteFilter::Untriaged => query = query.filter(notes::lifecycle_kind.eq("expires")),
    }

    if !request.languages.is_empty() {
        let selected: Vec<String> = request.languages.iter().map(ToString::to_string).collect();
        query = query.filter(notes::language.eq_any(selected));
    }

    // Same normalisation as on write, or a typed `#urgent` misses `urgent`.
    let selected_tags = model::normalize_tags(&request.tags);
    if !selected_tags.is_empty() {
        query = query.filter(
            notes::id.eq_any(
                note_tags::table
                    .select(note_tags::note_id)
                    .filter(note_tags::tag.eq_any(selected_tags)),
            ),
        );
    }

    // On `updated_at` although the sections group on `created_at`: the section
    // says when a note was born, the order within it which one moved last.
    let mut notes = query
        .order((notes::updated_at.desc(), notes::id.asc()))
        .load::<NoteRow>(connection)?
        .into_iter()
        .map(Note::try_from)
        .collect::<Result<Vec<_>, _>>()?;

    attach_related(connection, &mut notes, request.space_id.as_deref())?;

    Ok((notes, facets(connection, request.space_id.as_deref())?))
}

fn find(connection: &mut SqliteConnection, id: &str) -> Result<Option<Note>, StorageError> {
    let Some(row) = notes::table
        .find(id)
        .filter(notes::deleted_at.is_null())
        .select(NoteRow::as_select())
        .first::<NoteRow>(connection)
        .optional()?
    else {
        return Ok(None);
    };

    Ok(Some(Note {
        tags: tags_of(connection, id)?,
        items: items_of(connection, id)?,
        placeholder_values: placeholder_values_of(connection, id)?,
        ..Note::try_from(row)?
    }))
}

pub fn create(
    connection: &mut SqliteConnection,
    draft: NoteDraft,
    now: DateTime<Utc>,
) -> Result<Note, StorageError> {
    connection.transaction(|connection| {
        if !spaces::exists(connection, &draft.space_id)? {
            return Err(StorageError::SpaceNotFound(draft.space_id));
        }

        let mut note = draft.into_note(Uuid::new_v4().to_string(), now);

        diesel::insert_into(notes::table)
            .values(NoteRow::from(&note))
            .execute(connection)?;
        let written = std::mem::take(&mut note.tags);
        note.tags = replace_tags(connection, &note.id, &written)?;
        replace_items(connection, &note.id, &note.items)?;

        Ok(note)
    })
}

pub fn update(
    connection: &mut SqliteConnection,
    id: &str,
    patch: &NotePatch,
    now: DateTime<Utc>,
) -> Result<Note, StorageError> {
    connection.transaction(|connection| {
        let Some(mut note) = find(connection, id)? else {
            return Err(StorageError::NoteNotFound(id.to_string()));
        };

        if let Some(space_id) = &patch.space_id
            && !spaces::exists(connection, space_id)?
        {
            return Err(StorageError::SpaceNotFound(space_id.clone()));
        }

        patch.apply(&mut note, now);

        // Columns listed rather than an `AsChangeset`, which would also rewrite
        // `created_at`.
        let row = NoteRow::from(&note);
        diesel::update(notes::table.find(&note.id))
            .set((
                notes::space_id.eq(&row.space_id),
                notes::title.eq(&row.title),
                notes::language.eq(&row.language),
                notes::content.eq(&row.content),
                notes::source.eq(&row.source),
                notes::pinned.eq(row.pinned),
                notes::updated_at.eq(&row.updated_at),
                notes::lifecycle_kind.eq(&row.lifecycle_kind),
                notes::lifecycle_expires_at.eq(&row.lifecycle_expires_at),
                notes::kind.eq(&row.kind),
            ))
            .execute(connection)?;

        if patch.tags.is_some() {
            let written = std::mem::take(&mut note.tags);
            note.tags = replace_tags(connection, &note.id, &written)?;
        }

        if patch.items.is_some() {
            replace_items(connection, &note.id, &note.items)?;
        }

        Ok(note)
    })
}

/// ⚠️ **`updated_at` is not touched**: filling a field is not editing the note,
/// and the canvas sorts on that column.
pub fn set_placeholder_values(
    connection: &mut SqliteConnection,
    id: &str,
    values: &BTreeMap<String, String>,
) -> Result<Note, StorageError> {
    connection.transaction(|connection| {
        let Some(mut note) = find(connection, id)? else {
            return Err(StorageError::NoteNotFound(id.to_string()));
        };

        replace_placeholder_values(connection, id, values)?;
        note.placeholder_values = values.clone();

        Ok(note)
    })
}

pub fn delete(
    connection: &mut SqliteConnection,
    id: &str,
    now: DateTime<Utc>,
) -> Result<(), StorageError> {
    if delete_many(connection, std::slice::from_ref(&id.to_string()), now)? == 0 {
        return Err(StorageError::NoteNotFound(id.to_string()));
    }

    Ok(())
}

/// Returns what was actually moved: a selection can hold an id gone stale, and
/// failing the whole batch for one of them would be worse than a partial result.
pub fn delete_many(
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

    let mut grouped = all_tags(connection, None)?;
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

pub fn move_many(
    connection: &mut SqliteConnection,
    ids: &[String],
    space_id: &str,
    now: DateTime<Utc>,
) -> Result<usize, StorageError> {
    if ids.is_empty() {
        return Ok(0);
    }

    connection.transaction(|connection| {
        if !spaces::exists(connection, space_id)? {
            return Err(StorageError::SpaceNotFound(space_id.to_string()));
        }

        Ok(diesel::update(
            notes::table
                .filter(notes::id.eq_any(ids))
                .filter(notes::deleted_at.is_null())
                .filter(notes::space_id.ne(space_id)),
        )
        .set((
            notes::space_id.eq(space_id),
            notes::updated_at.eq(iso8601::format(now)),
        ))
        .execute(connection)?)
    })
}

pub fn tag_many(
    connection: &mut SqliteConnection,
    ids: &[String],
    tags: &[String],
    now: DateTime<Utc>,
) -> Result<usize, StorageError> {
    if ids.is_empty() || tags.is_empty() {
        return Ok(0);
    }

    connection.transaction(|connection| {
        let targets = notes::table
            .filter(notes::id.eq_any(ids))
            .filter(notes::deleted_at.is_null())
            .select(notes::id)
            .load::<String>(connection)?;

        let rows: Vec<_> = targets
            .iter()
            .flat_map(|note_id| {
                tags.iter()
                    .map(move |tag| (note_tags::note_id.eq(note_id), note_tags::tag.eq(tag)))
            })
            .collect();

        // `(note_id, tag)` is `NOCASE`: re-adding a tag already there is a no-op.
        diesel::insert_or_ignore_into(note_tags::table)
            .values(rows)
            .execute(connection)?;

        diesel::update(notes::table.filter(notes::id.eq_any(&targets)))
            .set(notes::updated_at.eq(iso8601::format(now)))
            .execute(connection)?;

        Ok(targets.len())
    })
}

pub fn tag_usage(connection: &mut SqliteConnection) -> Result<Vec<(String, i64)>, StorageError> {
    Ok(note_tags::table
        .inner_join(notes::table)
        .filter(notes::deleted_at.is_null())
        .group_by(note_tags::tag)
        .select((note_tags::tag, diesel::dsl::count_star()))
        .order(note_tags::tag.asc())
        .load::<(String, i64)>(connection)?)
}

/// Renames or merges: `sources` become `target` everywhere.
///
/// ⚠️ `updated_at` stays intact — the canvas sorts on it, and a corpus-wide
/// rename would float up notes nobody reopened.
pub fn retag(
    connection: &mut SqliteConnection,
    sources: &[String],
    target: &str,
) -> Result<usize, StorageError> {
    if sources.is_empty() {
        return Ok(0);
    }

    connection.transaction(|connection| {
        let renamed = note_tags::table
            .filter(note_tags::tag.eq_any(sources))
            .select(note_tags::note_id)
            .distinct()
            .load::<String>(connection)?;

        // The target is swept along with the sources then rewritten: the key is
        // `NOCASE`, so a pure case correction (`auth` → `Auth`) would be a no-op.
        let mut holders = renamed.clone();
        holders.extend(
            note_tags::table
                .filter(note_tags::tag.eq(target))
                .select(note_tags::note_id)
                .load::<String>(connection)?,
        );
        holders.sort();
        holders.dedup();

        diesel::delete(
            note_tags::table.filter(note_tags::tag.eq_any(sources).or(note_tags::tag.eq(target))),
        )
        .execute(connection)?;

        let rows: Vec<_> = holders
            .iter()
            .map(|note_id| (note_tags::note_id.eq(note_id), note_tags::tag.eq(target)))
            .collect();
        diesel::insert_into(note_tags::table)
            .values(rows)
            .execute(connection)?;

        Ok(renamed.len())
    })
}

pub fn drop_tags(
    connection: &mut SqliteConnection,
    tags: &[String],
) -> Result<usize, StorageError> {
    if tags.is_empty() {
        return Ok(0);
    }

    Ok(diesel::delete(note_tags::table.filter(note_tags::tag.eq_any(tags))).execute(connection)?)
}

pub fn drop_tag(connection: &mut SqliteConnection, tag: &str) -> Result<usize, StorageError> {
    drop_tags(connection, std::slice::from_ref(&tag.to_string()))
}

/// Export only: no command hands this list to the front, which would be tempted
/// to re-filter it.
pub fn all(
    connection: &mut SqliteConnection,
    space_id: Option<&str>,
) -> Result<Vec<Note>, StorageError> {
    let mut query = notes::table
        .filter(notes::deleted_at.is_null())
        .select(NoteRow::as_select())
        .into_boxed();

    if let Some(space_id) = space_id {
        query = query.filter(notes::space_id.eq(space_id.to_string()));
    }

    let mut notes = query
        .order((notes::created_at.asc(), notes::id.asc()))
        .load::<NoteRow>(connection)?
        .into_iter()
        .map(Note::try_from)
        .collect::<Result<Vec<_>, _>>()?;

    attach_related(connection, &mut notes, space_id)?;

    Ok(notes)
}

pub fn by_ids(
    connection: &mut SqliteConnection,
    ids: &[String],
) -> Result<Vec<Note>, StorageError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut notes = notes::table
        .filter(notes::id.eq_any(ids))
        .filter(notes::deleted_at.is_null())
        .select(NoteRow::as_select())
        .order((notes::created_at.asc(), notes::id.asc()))
        .load::<NoteRow>(connection)?
        .into_iter()
        .map(Note::try_from)
        .collect::<Result<Vec<_>, _>>()?;

    attach_related(connection, &mut notes, None)?;

    Ok(notes)
}

pub fn insert_imported(
    connection: &mut SqliteConnection,
    note: &Note,
) -> Result<bool, StorageError> {
    connection.transaction(|connection| {
        let taken = notes::table
            .find(&note.id)
            .select(notes::id)
            .first::<String>(connection)
            .optional()?
            .is_some();
        if taken {
            return Ok(false);
        }

        diesel::insert_into(notes::table)
            .values(NoteRow::from(note))
            .execute(connection)?;
        replace_tags(connection, &note.id, &model::normalize_tags(&note.tags))?;
        replace_items(
            connection,
            &note.id,
            &checklist::normalize_items(&note.items),
        )?;
        replace_placeholder_values(
            connection,
            &note.id,
            &placeholder::normalize_values(note.placeholder_values.clone()),
        )?;

        Ok(true)
    })
}
