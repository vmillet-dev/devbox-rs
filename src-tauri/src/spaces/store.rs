//! ⚠️ `spaces.name` is sealed, and that moves two things out of SQL: the order, and the
//! uniqueness check. Ciphertext sorts at random and two seals of the same name differ, so
//! `ORDER BY name COLLATE NOCASE` and `WHERE name = ? COLLATE NOCASE` both stopped
//! meaning anything. A library holds a handful of spaces, so both are cheap in Rust — the
//! same move would be unaffordable on the notes, which is why the notes are filtered on
//! columns that stay in the clear.

use diesel::prelude::*;

use super::model::Space;
use crate::db::Library;
use crate::db::schema::{notes, spaces};
use crate::error::StorageError;
use crate::vault::key::Vault;
use uuid::Uuid;

/// Pinned first, then by name — the same shape the canvas gives notes. Folded for the
/// comparison, so "personal" does not land after "Zebra".
fn in_display_order(spaces: &mut [Space]) {
    spaces.sort_by(|left, right| {
        right
            .pinned
            .cmp(&left.pinned)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

fn all(connection: &mut SqliteConnection, vault: &Vault) -> Result<Vec<Space>, StorageError> {
    spaces::table
        .select((spaces::id, spaces::name, spaces::pinned))
        .load::<(String, String, bool)>(connection)?
        .into_iter()
        .map(|(id, name, pinned)| {
            Ok(Space {
                id,
                name: vault.open(&name)?,
                pinned,
            })
        })
        .collect()
}

/// An empty list is valid: it is the state of the first launch.
pub fn list(connection: &mut Library) -> Result<Vec<Space>, StorageError> {
    let (db, vault) = connection.split();

    list_in(db, vault)
}

/// For a caller already inside a transaction, which holds the two halves apart.
pub(crate) fn list_in(
    connection: &mut SqliteConnection,
    vault: &Vault,
) -> Result<Vec<Space>, StorageError> {
    let mut spaces = all(connection, vault)?;
    in_display_order(&mut spaces);

    Ok(spaces)
}

/// Reads back, so a rename does not quietly drop whether the space was pinned.
fn find(connection: &mut SqliteConnection, vault: &Vault, id: &str) -> Result<Space, StorageError> {
    spaces::table
        .find(id)
        .select((spaces::id, spaces::name, spaces::pinned))
        .first::<(String, String, bool)>(connection)
        .optional()?
        .map(|(id, name, pinned)| -> Result<Space, StorageError> {
            Ok(Space {
                id,
                name: vault.open(&name)?,
                pinned,
            })
        })
        .transpose()?
        .ok_or_else(|| StorageError::SpaceNotFound(id.to_string()))
}

pub fn set_pinned(connection: &mut Library, id: &str, pinned: bool) -> Result<Space, StorageError> {
    connection.transaction(|connection, vault| {
        if !exists(connection, id)? {
            return Err(StorageError::SpaceNotFound(id.to_string()));
        }

        diesel::update(spaces::table.find(id))
            .set(spaces::pinned.eq(pinned))
            .execute(connection)?;

        find(connection, vault, id)
    })
}

/// The foreign key would catch it too, but with a message the front cannot translate.
pub fn exists(connection: &mut SqliteConnection, id: &str) -> Result<bool, StorageError> {
    let found = spaces::table
        .find(id)
        .select(spaces::id)
        .first::<String>(connection)
        .optional()?;

    Ok(found.is_some())
}

/// Detected here rather than left to the unique index, to return a code the front can
/// translate. `except_id` excludes the renamed space, or correcting the case of a name
/// would be refused as a duplicate of itself.
///
/// ⚠️ Every name is opened to answer. The unique index on the column is now an index on
/// ciphertext and catches nothing — this is the only thing standing between the user and
/// two spaces that look identical.
fn ensure_unique_name(
    connection: &mut SqliteConnection,
    vault: &Vault,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), StorageError> {
    let taken = all(connection, vault)?.into_iter().any(|space| {
        Some(space.id.as_str()) != except_id && space.name.to_lowercase() == name.to_lowercase()
    });

    if taken {
        return Err(StorageError::DuplicateSpaceName(name.to_string()));
    }

    Ok(())
}

/// `name` is expected already validated: this layer only decides uniqueness, and the
/// transaction is what pairs the check with the write.
pub fn create(connection: &mut Library, name: &str) -> Result<Space, StorageError> {
    connection.transaction(|connection, vault| create_in(connection, vault, name))
}

/// For a caller already inside a transaction — an import creates the spaces it needs.
pub(crate) fn create_in(
    connection: &mut SqliteConnection,
    vault: &Vault,
    name: &str,
) -> Result<Space, StorageError> {
    {
        ensure_unique_name(connection, vault, name, None)?;

        let space = Space {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            pinned: false,
        };

        diesel::insert_into(spaces::table)
            .values((
                spaces::id.eq(&space.id),
                spaces::name.eq(vault.seal(&space.name)?),
            ))
            .execute(connection)?;

        Ok(space)
    }
}

pub fn rename(connection: &mut Library, id: &str, name: &str) -> Result<Space, StorageError> {
    connection.transaction(|connection, vault| {
        if !exists(connection, id)? {
            return Err(StorageError::SpaceNotFound(id.to_string()));
        }

        ensure_unique_name(connection, vault, name, Some(id))?;

        diesel::update(spaces::table.find(id))
            .set(spaces::name.eq(vault.seal(name)?))
            .execute(connection)?;

        find(connection, vault, id)
    })
}

/// ⚠️ Same transaction and this order: `notes.space_id` has an `ON DELETE CASCADE`, so
/// deleting first — or failing between the two — sweeps away the notes instead of moving
/// them. `updated_at` is not refreshed, or the absorbed space floats to the top.
pub fn delete(connection: &mut Library, id: &str, target_id: &str) -> Result<(), StorageError> {
    connection.transaction(|connection, _vault| {
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
