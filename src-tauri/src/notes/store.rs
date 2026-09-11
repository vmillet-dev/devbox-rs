//! Reading and writing notes: **SQL, and nothing else**.
//!
//! Only what SQLite indexes goes down into the `WHERE` clause. Text search,
//! sections and tag normalization are rules: `super::view` and
//! `super::model`.

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

/// `lifecycle` is split into two columns here; tags, checklist items and filled
/// fields are absent: they live in `note_tags`, `note_items` and
/// `note_placeholders`, then get attached in a single query for the whole list.
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

/// An unreadable date makes the **read fail**: these columns are only written
/// by [`iso8601::format`], so an out-of-format value signals a corrupted
/// database, and guessing would place the note at an arbitrary date without saying anything.
///
/// The language, however, falls back to its default: `notes.language` carries no
/// `CHECK` (migration 3), a newer version may have written a legitimate language
/// that this one ignores. The note remains readable, without its highlighting.
/// `kind` follows the same rule, and for the same reason.
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

/// The living notes of one space, as a subquery the side tables filter on.
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

/// One query per side table for the whole list, never one per note — and
/// narrowed to the active space, which is what a filtered canvas asks for.
///
/// ⚠️ Narrowed by **subquery**, not by a list of bound ids: binding one
/// parameter per note costs more than the read itself past a few thousand
/// notes, where the subquery rides an index and binds a single value. Reading a
/// superset is harmless — `attach_related` only looks up the notes it holds.
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

/// Writes tags the domain has **already normalised**, and returns what reading
/// them back gives.
///
/// ⚠️ Re-read rather than sorted here: `note_tags.tag` is `COLLATE NOCASE` and a
/// read orders in that collation, which a byte-wise `sort()` does not reproduce
/// — `Urgent` would come before `auth` on write and after it on reload.
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

/// Narrowed like [`all_tags`].
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

/// Writes items the domain has **already normalised**.
///
/// Wiped then reinserted, like the tags: the position is part of the key, so
/// reordering would otherwise mean moving rows one at a time under a primary
/// key that refuses duplicates along the way.
///
/// No re-read here, unlike the tags: `position` orders numerically, which the
/// insertion order reproduces exactly.
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
/// Attaches what lives in the neighbouring tables: one query per table for the
/// whole list, never one per note.
///
/// All three count: the domain search reads the items — a todo list has no
/// other content — and a snippet card with fields offers to fill them, which it
/// cannot do without the values already typed.
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

/// Narrowed like [`all_tags`].
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

/// Writes values the domain has **already normalised**.
///
/// Wiped then reinserted, like the tags: what is no longer sent is what the
/// user cleared, and a partial write would leave an emptied value still filling
/// the text.
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

/// The **global variables**: `{{field}}` values with no note to carry them,
/// valid across the whole corpus.
///
/// Sorted by name, which is the preferences panel's order. The `BTreeMap` would
/// hold it anyway; the `ORDER BY` only says the order is meant rather than
/// incidental.
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

/// Writes variables the domain has **already normalised**.
///
/// Wiped then reinserted, like the tags: what is no longer sent is what the
/// user removed, and a partial write would leave a deleted variable still
/// filling tokens.
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
///
/// The join on `notes` is unconditional: every `note_tags` row points at an
/// existing note, so it neither adds nor removes anything when no space is
/// active.
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
        // A stored language this build does not know has no facet to offer: the
        // rail cannot present a filter the front cannot name.
        languages: languages
            .load::<String>(connection)?
            .iter()
            .filter_map(|language| language.parse().ok())
            .collect(),
    })
}

/// **Coarse** criteria only; `view::build` takes over for the text search and
/// the sections.
pub fn fetch(
    connection: &mut SqliteConnection,
    request: &NotesQuery,
) -> Result<(Vec<Note>, Facets), StorageError> {
    // The trash is visible only through `list_trashed`: a deleted note surfacing
    // here would be editable without ever saying it is on borrowed time.
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
        // Union, like the tags: picking JSON then YAML shows both.
        let selected: Vec<String> = request.languages.iter().map(ToString::to_string).collect();
        query = query.filter(notes::language.eq_any(selected));
    }

    // Same normalisation as on write, otherwise a typed `#urgent` would not find
    // the stored `urgent`.
    let selected_tags = model::normalize_tags(&request.tags);
    if !selected_tags.is_empty() {
        // "at least one tag", not "all": the behaviour of a facet rail.
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

/// Returns the persisted version — identifier and timestamps included. The
/// front adopts it as is.
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

/// Reads, applies the patch, writes back — in a transaction so no command can
/// slip in between. The merge is a rule and lives in [`NotePatch::apply`].
///
/// An unknown identifier gives `Err`: the front would otherwise believe it saved.
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

        // The one check the domain cannot make: it needs the database.
        if let Some(space_id) = &patch.space_id
            && !spaces::exists(connection, space_id)?
        {
            return Err(StorageError::SpaceNotFound(space_id.clone()));
        }

        patch.apply(&mut note, now);

        // Columns listed rather than an `AsChangeset`, which would also rewrite
        // `created_at` — the one stamp nothing here may move.
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

/// Stores what was typed into the note's `{{fields}}`.
///
/// ⚠️ **`updated_at` is not touched**, and that is the whole point: filling a
/// field is not editing the note. The canvas sorts on that column and would
/// otherwise float the note to the top for a value typed in the panel.
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

/// **Does not delete**: stamps the note, which joins the trash. Deleting for
/// good is [`purge`], and retention is a rule of `super::trash`.
///
/// An unknown — or already trashed — identifier gives `Err`.
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

/// The number of notes actually moved: a selection can hold an id that went
/// stale, and failing the whole batch for one of them would be worse than a
/// partial result.
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

/// Out of the trash. `updated_at` is not touched: the note comes back where it
/// was, not at the top of the canvas.
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

/// The trashed notes, most recently deleted first.
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

/// Ids of the notes whose retention has run out. Separate from [`purge`] so the
/// caller can collect the attached files to erase first.
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

/// **Permanent** deletion. Tags and attachments leave by cascade — hence the
/// `PRAGMA foreign_keys` in `db::configure`; the files on disk are the caller's
/// business.
///
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

/// Bulk move. The destination space is checked once for the whole batch.
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

/// Adds **already normalised** tags without touching those already set: a bulk
/// action enriches, it does not replace.
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

        // `insert_or_ignore`: the primary key `(note_id, tag)` is `NOCASE`, so
        // re-adding a tag already there does nothing rather than failing.
        diesel::insert_or_ignore_into(note_tags::table)
            .values(rows)
            .execute(connection)?;

        diesel::update(notes::table.filter(notes::id.eq_any(&targets)))
            .set(notes::updated_at.eq(iso8601::format(now)))
            .execute(connection)?;

        Ok(targets.len())
    })
}

/// Every tag of the corpus and the number of living notes carrying it.
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
/// ⚠️ `updated_at` stays intact. A corpus-wide rename would otherwise touch
/// everything, and the canvas — which sorts on it — would float up notes nobody
/// reopened.
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

        // The target is swept along with the sources then rewritten, which is
        // what makes a pure case correction take effect: the primary key is
        // `NOCASE`, so "Auth" and "auth" are the same row there.
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

/// Removes tags from the corpus. The notes stay; only the labelling goes.
pub fn drop_tags(
    connection: &mut SqliteConnection,
    tags: &[String],
) -> Result<usize, StorageError> {
    if tags.is_empty() {
        return Ok(0);
    }

    Ok(diesel::delete(note_tags::table.filter(note_tags::tag.eq_any(tags))).execute(connection)?)
}

/// One tag, as [`drop_tags`] sees it.
pub fn drop_tag(connection: &mut SqliteConnection, tag: &str) -> Result<usize, StorageError> {
    drop_tags(connection, std::slice::from_ref(&tag.to_string()))
}

/// Every living note of a space — or of the corpus. Export only: no command
/// hands this list to the front, which would be tempted to re-filter it.
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

/// Notes named by their id, in database order. Used to share a selection.
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

    // No space narrows a selection: it can straddle several, and the extra
    // rows read are only a superset the lookup ignores.
    attach_related(connection, &mut notes, None)?;

    Ok(notes)
}

/// Writes an imported note, **with its identifier and its dates**.
///
/// An id already present is not overwritten: the return says whether a write
/// happened, and the import counts what it skipped.
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
