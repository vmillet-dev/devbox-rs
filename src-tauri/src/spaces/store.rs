use diesel::dsl::sql;
use diesel::prelude::*;
use diesel::sql_types::{Bool, Text};

use super::model::Space;
use crate::db::schema::{notes, spaces};
use crate::error::StorageError;
use uuid::Uuid;

/// An empty list is valid: it is the state of the first launch.
pub fn list(connection: &mut SqliteConnection) -> Result<Vec<Space>, StorageError> {
    let rows = spaces::table
        .select((spaces::id, spaces::name))
        // Raw fragment: Diesel does not model collations, and sorting as BINARY
        // would place "personal" after "Zebra".
        .order(sql::<Text>("name COLLATE NOCASE"))
        .load::<(String, String)>(connection)?;

    Ok(rows
        .into_iter()
        .map(|(id, name)| Space { id, name })
        .collect())
}

/// The foreign key would catch it too, but with an unreadable SQLite message
/// whereas the front end displays the error.
pub fn exists(connection: &mut SqliteConnection, id: &str) -> Result<bool, StorageError> {
    let found = spaces::table
        .find(id)
        .select(spaces::id)
        .first::<String>(connection)
        .optional()?;

    Ok(found.is_some())
}

/// Detected here rather than left to the unique index, to return a code the front
/// end knows how to translate. `except_id` excludes the renamed space: without it,
/// correcting the case of a name would be refused as a duplicate of itself.
fn ensure_unique_name(
    connection: &mut SqliteConnection,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), StorageError> {
    // ⚠️ `spaces.name` is not declared `NOCASE` — only the unique index is — so the
    // collation must be set on the comparison, or "PERSONAL" would miss "Personal".
    let mut query = spaces::table
        .filter(
            sql::<Bool>("name = ")
                .bind::<Text, _>(name.to_string())
                .sql(" COLLATE NOCASE"),
        )
        .into_boxed();

    if let Some(id) = except_id {
        query = query.filter(spaces::id.ne(id.to_string()));
    }

    if query.count().get_result::<i64>(connection)? > 0 {
        return Err(StorageError::DuplicateSpaceName(name.to_string()));
    }

    Ok(())
}

/// `name` is expected **already validated**: this layer only decides uniqueness.
///
/// The transaction is what pairs the check with the write. Without it the guarantee
/// rested on the connection mutex two layers up, where nothing named it.
pub fn create(connection: &mut SqliteConnection, name: &str) -> Result<Space, StorageError> {
    connection.transaction(|connection| {
        ensure_unique_name(connection, name, None)?;

        let space = Space {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
        };

        diesel::insert_into(spaces::table)
            .values((spaces::id.eq(&space.id), spaces::name.eq(&space.name)))
            .execute(connection)?;

        Ok(space)
    })
}

pub fn rename(
    connection: &mut SqliteConnection,
    id: &str,
    name: &str,
) -> Result<Space, StorageError> {
    connection.transaction(|connection| {
        if !exists(connection, id)? {
            return Err(StorageError::SpaceNotFound(id.to_string()));
        }

        ensure_unique_name(connection, name, Some(id))?;

        diesel::update(spaces::table.find(id))
            .set(spaces::name.eq(name))
            .execute(connection)?;

        Ok(Space {
            id: id.to_string(),
            name: name.to_string(),
        })
    })
}

/// ⚠️ Same transaction and **this order**: `notes.space_id` has an `ON DELETE
/// CASCADE`, so deleting first — or failing between the two — would sweep away the
/// notes instead of moving them.
///
/// `updated_at` is not refreshed: touching it would float the whole absorbed space
/// to the top of the canvas, which sorts on it.
pub fn delete(
    connection: &mut SqliteConnection,
    id: &str,
    target_id: &str,
) -> Result<(), StorageError> {
    connection.transaction(|connection| {
        if !exists(connection, id)? {
            return Err(StorageError::SpaceNotFound(id.to_string()));
        }
        if !exists(connection, target_id)? {
            return Err(StorageError::SpaceNotFound(target_id.to_string()));
        }

        diesel::update(notes::table.filter(notes::space_id.eq(id)))
            .set(notes::space_id.eq(target_id))
            .execute(connection)?;
        diesel::delete(spaces::table.find(id)).execute(connection)?;

        Ok(())
    })
}
