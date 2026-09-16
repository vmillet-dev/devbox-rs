pub mod related;
pub mod trash;

use std::collections::BTreeMap;

use diesel::prelude::*;
use uuid::Uuid;

use chrono::{DateTime, Utc};

use super::checklist;
use super::model::{self, Note, NoteDraft, NoteLifecycle, NotePatch};
use super::placeholder;
use super::view::{Facets, NoteFilter, NotesQuery};
use crate::db::schema::{global_placeholders, note_tags, notes};
use crate::db::{Library, iso8601};
use crate::error::StorageError;
use crate::spaces::model::Space;
use crate::spaces::store as spaces;
use crate::vault::key::Vault;

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = notes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub(super) struct NoteRow {
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

/// ⚠️ Not a `TryFrom`: opening a row needs the key, and a trait cannot take one. The
/// same goes for [`NoteRow::seal`] in the other direction.
///
/// An unreadable date fails the read: these columns are only ever written by
/// [`iso8601::format`]. Language and `kind` degrade instead — a newer version may have
/// written a value this build does not know. ⚠️ A value that will not open does **not**
/// degrade: a wrong key must stop the read rather than hand back plausible emptiness.
impl NoteRow {
    fn open(row: Self, vault: &Vault) -> Result<Note, StorageError> {
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

        Ok(Note {
            created_at: instant("createdAt", &row.created_at)?,
            updated_at: instant("updatedAt", &row.updated_at)?,
            language: row.language.parse().unwrap_or_default(),
            kind: row.kind.parse().unwrap_or_default(),
            title: vault.open(&row.title)?,
            content: vault.open(&row.content)?,
            source: vault.open(&row.source)?,
            id: row.id,
            space_id: row.space_id,
            tags: Vec::new(),
            items: Vec::new(),
            placeholder_values: BTreeMap::new(),
            pinned: row.pinned,
            lifecycle,
        })
    }

    /// ⚠️ `space_id`, the instants, `pinned`, `language` and `kind` stay in the clear:
    /// every one of them is filtered, ordered or grouped on in SQL, and sealing one would
    /// move that work into Rust for no secret. What is sealed is what a reader would want.
    fn seal(note: &Note, vault: &Vault) -> Result<Self, StorageError> {
        let (lifecycle_kind, lifecycle_expires_at) = match note.lifecycle {
            NoteLifecycle::Permanent => ("permanent", None),
            NoteLifecycle::Expires { at } => ("expires", Some(iso8601::format(at))),
        };

        Ok(Self {
            id: note.id.clone(),
            space_id: note.space_id.clone(),
            title: vault.seal(&note.title)?,
            language: note.language.to_string(),
            content: vault.seal(&note.content)?,
            source: vault.seal(&note.source)?,
            pinned: note.pinned,
            created_at: iso8601::format(note.created_at),
            updated_at: iso8601::format(note.updated_at),
            lifecycle_kind: lifecycle_kind.to_string(),
            lifecycle_expires_at,
            kind: note.kind.to_string(),
        })
    }
}

/// What an update actually writes.
///
/// ⚠️ Every column is optional so an untouched one is left alone — `None` emits no
/// assignment at all. That is what stops a value this build cannot parse from being
/// overwritten: an older binary reads `language = "rust"` as `txt`, and writing all ten
/// columns back would have made that fallback permanent, in the database, with no error
/// anywhere. `updated_at` is not optional because refreshing it is what the patch path
/// exists for.
#[derive(AsChangeset)]
#[diesel(table_name = notes)]
struct NoteChanges {
    space_id: Option<String>,
    title: Option<String>,
    language: Option<String>,
    content: Option<String>,
    source: Option<String>,
    pinned: Option<bool>,
    updated_at: String,
    lifecycle_kind: Option<String>,
    /// ⚠️ Twice optional, and both layers matter: the outer one skips the column, the
    /// inner one is the `NULL` a permanent note needs written. Diesel’s own idiom for a
    /// nullable column, and the three cases are exactly the three the lint asks about.
    #[allow(clippy::option_option)]
    lifecycle_expires_at: Option<Option<String>>,
    kind: Option<String>,
}

/// ⚠️ Every row or none: a value that will not open stops the read rather than handing
/// back a note with an empty body. A wrong key is not a degraded note.
fn open_all(rows: Vec<NoteRow>, vault: &Vault) -> Result<Vec<Note>, StorageError> {
    rows.into_iter()
        .map(|row| NoteRow::open(row, vault))
        .collect()
}

pub(super) fn notes_of_space(
    space_id: &str,
) -> diesel::helper_types::Filter<
    diesel::helper_types::Select<notes::table, notes::id>,
    diesel::dsl::Eq<notes::space_id, String>,
> {
    notes::table
        .select(notes::id)
        .filter(notes::space_id.eq(space_id.to_string()))
}

/// ⚠️ The value is sealed like a note's own, the name is not: the name is the key rows
/// are found by, and a variable called `host` is worth a good deal less than what it holds.
pub fn global_placeholder_values(
    connection: &mut Library,
) -> Result<BTreeMap<String, String>, StorageError> {
    let (db, vault) = connection.split();

    global_placeholders::table
        .select((global_placeholders::name, global_placeholders::value))
        .order(global_placeholders::name.asc())
        .load::<(String, String)>(db)?
        .into_iter()
        .map(|(name, value)| Ok((name, vault.open(&value)?)))
        .collect::<Result<BTreeMap<_, _>, StorageError>>()
}

pub fn replace_global_placeholder_values(
    connection: &mut Library,
    values: &BTreeMap<String, String>,
) -> Result<(), StorageError> {
    connection.transaction(|connection, vault| {
        diesel::delete(global_placeholders::table).execute(connection)?;

        if !values.is_empty() {
            let rows: Vec<_> = values
                .iter()
                .map(|(name, value)| {
                    Ok((
                        global_placeholders::name.eq(name),
                        global_placeholders::value.eq(vault.seal(value)?),
                    ))
                })
                .collect::<Result<Vec<_>, StorageError>>()?;
            diesel::insert_into(global_placeholders::table)
                .values(rows)
                .execute(connection)?;
        }

        Ok(())
    })
}

/// Scoped to the space and not to the current filter — see [`NotesView`].
fn facets(connection: &mut Library, space_id: Option<&str>) -> Result<Facets, StorageError> {
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
        tags: tags.load::<String>(connection.db())?,
        // A stored language this build does not know has no facet to offer.
        languages: languages
            .load::<String>(connection.db())?
            .iter()
            .filter_map(|language| language.parse().ok())
            .collect(),
    })
}

/// Coarse criteria only; `view::build` takes over for search and sections.
pub fn fetch(
    connection: &mut Library,
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

    // Same normalization as on write, or a typed `#urgent` misses `urgent`.
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

    // On `updated_at` although the sections group on `created_at`: the section says when
    // a note was born, the order within it which one moved last.
    let rows = query
        .order((notes::updated_at.desc(), notes::id.asc()))
        .load::<NoteRow>(connection.db())?;
    let (db, vault) = connection.split();
    let mut notes = open_all(rows, vault)?;
    related::attach_related(db, vault, &mut notes, request.space_id.as_deref())?;

    Ok((notes, facets(connection, request.space_id.as_deref())?))
}

fn find(
    connection: &mut SqliteConnection,
    vault: &Vault,
    id: &str,
) -> Result<Option<Note>, StorageError> {
    let Some(row) = notes::table
        .find(id)
        .filter(notes::deleted_at.is_null())
        .select(NoteRow::as_select())
        .first::<NoteRow>(connection)
        .optional()?
    else {
        return Ok(None);
    };

    let tags = related::tags_of(connection, id)?;
    let items = related::items_of(connection, vault, id)?;
    let placeholder_values = related::placeholder_values_of(connection, vault, id)?;

    Ok(Some(Note {
        tags,
        items,
        placeholder_values,
        ..NoteRow::open(row, vault)?
    }))
}

pub fn create(
    connection: &mut Library,
    draft: NoteDraft,
    now: DateTime<Utc>,
) -> Result<Note, StorageError> {
    connection.transaction(|connection, vault| create_in(connection, vault, draft, now))
}

/// For a caller already inside a transaction — the first launch writes a space and four
/// notes as one.
pub(crate) fn create_in(
    connection: &mut SqliteConnection,
    vault: &Vault,
    draft: NoteDraft,
    now: DateTime<Utc>,
) -> Result<Note, StorageError> {
    if !spaces::exists(connection, &draft.space_id)? {
        return Err(StorageError::SpaceNotFound(draft.space_id));
    }

    let mut note = draft.into_note(Uuid::new_v4().to_string(), now);

    diesel::insert_into(notes::table)
        .values(NoteRow::seal(&note, vault)?)
        .execute(connection)?;
    let written = std::mem::take(&mut note.tags);
    note.tags = related::replace_tags(connection, &note.id, &written)?;
    related::replace_items(connection, vault, &note.id, &note.items)?;

    Ok(note)
}

/// The first launch, as one write.
///
/// ⚠️ The space and its notes commit together or not at all. Six round trips used to
/// seed them — one space, one marker, four notes — and a process that died between any
/// two left a space standing with nothing in it, which both of `seedIfFirstRun`'s guards
/// then read as "already seeded". The canvas stayed empty for the life of that install.
///
/// ⚠️ Each draft's own `space_id` is ignored and replaced: the front end composes the
/// drafts before the space it files them into exists.
pub fn seed(
    connection: &mut Library,
    space_name: &str,
    drafts: Vec<NoteDraft>,
    now: DateTime<Utc>,
) -> Result<Space, StorageError> {
    connection.transaction(|connection, vault| {
        let space = spaces::create_in(connection, vault, space_name)?;

        for draft in drafts {
            // Sequential, and `now` is shared: `created_at` is what orders the canvas,
            // so the samples keep the order they were written in.
            create_in(
                connection,
                vault,
                NoteDraft {
                    space_id: space.id.clone(),
                    ..draft
                },
                now,
            )?;
        }

        Ok(space)
    })
}

pub fn update(
    connection: &mut Library,
    id: &str,
    patch: &NotePatch,
    now: DateTime<Utc>,
) -> Result<Note, StorageError> {
    connection.transaction(|connection, vault| {
        let Some(mut note) = find(connection, vault, id)? else {
            return Err(StorageError::NoteNotFound(id.to_string()));
        };

        if let Some(space_id) = &patch.space_id
            && !spaces::exists(connection, space_id)?
        {
            return Err(StorageError::SpaceNotFound(space_id.clone()));
        }

        // ⚠️ Compared against the note as it was read, not against the patch's own
        // fields: `apply` moves more than it is handed — a new body re-detects the
        // language — and a column the patch never named can still have changed.
        let before = note.clone();
        patch.apply(&mut note, now);

        let row = NoteRow::seal(&note, vault)?;
        let moved = |changed: bool, value: &String| changed.then(|| value.clone());
        let lifecycle_moved = note.lifecycle != before.lifecycle;

        diesel::update(notes::table.find(&note.id))
            .set(NoteChanges {
                space_id: moved(note.space_id != before.space_id, &row.space_id),
                title: moved(note.title != before.title, &row.title),
                language: moved(note.language != before.language, &row.language),
                content: moved(note.content != before.content, &row.content),
                source: moved(note.source != before.source, &row.source),
                pinned: (note.pinned != before.pinned).then_some(row.pinned),
                updated_at: row.updated_at.clone(),
                lifecycle_kind: moved(lifecycle_moved, &row.lifecycle_kind),
                lifecycle_expires_at: lifecycle_moved.then(|| row.lifecycle_expires_at.clone()),
                kind: moved(note.kind != before.kind, &row.kind),
            })
            .execute(connection)?;

        if patch.tags.is_some() {
            let written = std::mem::take(&mut note.tags);
            note.tags = related::replace_tags(connection, &note.id, &written)?;
        }

        if patch.items.is_some() {
            related::replace_items(connection, vault, &note.id, &note.items)?;
        }

        Ok(note)
    })
}

/// ⚠️ `updated_at` is not touched: filling a field is not editing the note, and the
/// canvas sorts on that column.
pub fn set_placeholder_values(
    connection: &mut Library,
    id: &str,
    values: &BTreeMap<String, String>,
) -> Result<Note, StorageError> {
    connection.transaction(|connection, vault| {
        let Some(mut note) = find(connection, vault, id)? else {
            return Err(StorageError::NoteNotFound(id.to_string()));
        };

        related::replace_placeholder_values(connection, vault, id, values)?;
        note.placeholder_values = values.clone();

        Ok(note)
    })
}

pub fn move_many(
    connection: &mut Library,
    ids: &[String],
    space_id: &str,
    now: DateTime<Utc>,
) -> Result<usize, StorageError> {
    if ids.is_empty() {
        return Ok(0);
    }

    connection.transaction(|connection, _vault| {
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
    connection: &mut Library,
    ids: &[String],
    tags: &[String],
    now: DateTime<Utc>,
) -> Result<usize, StorageError> {
    if ids.is_empty() || tags.is_empty() {
        return Ok(0);
    }

    connection.transaction(|connection, _vault| {
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

pub fn tag_usage(connection: &mut Library) -> Result<Vec<(String, i64)>, StorageError> {
    Ok(note_tags::table
        .inner_join(notes::table)
        .filter(notes::deleted_at.is_null())
        .group_by(note_tags::tag)
        .select((note_tags::tag, diesel::dsl::count_star()))
        .order(note_tags::tag.asc())
        .load::<(String, i64)>(connection.db())?)
}

/// ⚠️ `updated_at` stays intact — the canvas sorts on it, and a corpus-wide rename would
/// float up notes nobody reopened.
pub fn retag(
    connection: &mut Library,
    sources: &[String],
    target: &str,
) -> Result<usize, StorageError> {
    if sources.is_empty() {
        return Ok(0);
    }

    connection.transaction(|connection, _vault| {
        let renamed = note_tags::table
            .filter(note_tags::tag.eq_any(sources))
            .select(note_tags::note_id)
            .distinct()
            .load::<String>(connection)?;

        // ⚠️ The target is swept along with the sources then rewritten: the key is
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

pub fn drop_tags(connection: &mut Library, tags: &[String]) -> Result<usize, StorageError> {
    if tags.is_empty() {
        return Ok(0);
    }

    Ok(
        diesel::delete(note_tags::table.filter(note_tags::tag.eq_any(tags)))
            .execute(connection.db())?,
    )
}

/// Export only: no command hands this list to the front, which would re-filter it.
pub fn all(connection: &mut Library, space_id: Option<&str>) -> Result<Vec<Note>, StorageError> {
    let mut query = notes::table
        .filter(notes::deleted_at.is_null())
        .select(NoteRow::as_select())
        .into_boxed();

    if let Some(space_id) = space_id {
        query = query.filter(notes::space_id.eq(space_id.to_string()));
    }

    let rows = query
        .order((notes::created_at.asc(), notes::id.asc()))
        .load::<NoteRow>(connection.db())?;
    let (db, vault) = connection.split();
    let mut notes = open_all(rows, vault)?;
    related::attach_related(db, vault, &mut notes, space_id)?;

    Ok(notes)
}

pub fn by_ids(connection: &mut Library, ids: &[String]) -> Result<Vec<Note>, StorageError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = notes::table
        .filter(notes::id.eq_any(ids))
        .filter(notes::deleted_at.is_null())
        .select(NoteRow::as_select())
        .order((notes::created_at.asc(), notes::id.asc()))
        .load::<NoteRow>(connection.db())?;
    let (db, vault) = connection.split();
    let mut notes = open_all(rows, vault)?;
    related::attach_related(db, vault, &mut notes, None)?;

    Ok(notes)
}

pub fn insert_imported(connection: &mut Library, note: &Note) -> Result<bool, StorageError> {
    connection.transaction(|connection, vault| insert_imported_in(connection, vault, note))
}

/// For a caller already inside a transaction: an import is one transaction for the whole
/// file, and every note it brings in runs inside it.
pub(crate) fn insert_imported_in(
    connection: &mut SqliteConnection,
    vault: &Vault,
    note: &Note,
) -> Result<bool, StorageError> {
    {
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
            .values(NoteRow::seal(note, vault)?)
            .execute(connection)?;
        related::replace_tags(connection, &note.id, &model::normalize_tags(&note.tags))?;
        related::replace_items(
            connection,
            vault,
            &note.id,
            &checklist::normalize_items(&note.items),
        )?;
        related::replace_placeholder_values(
            connection,
            vault,
            &note.id,
            &placeholder::normalize_values(note.placeholder_values.clone()),
        )?;

        Ok(true)
    }
}
