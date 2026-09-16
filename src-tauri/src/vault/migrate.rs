//! Turning a library that was written in the clear into a sealed one.
//!
//! ⚠️ Run once, from [`super::create_vault`], on a database that already exists. Every
//! sealed column is read as it stands and written back sealed, in **one transaction** —
//! a half-sealed library opens into a mixture nothing can tell apart, since a value that
//! will not open is refused rather than degraded.
//!
//! ⚠️ The attachment files are sealed after the transaction commits, and not inside it:
//! a file write does not roll back. A file left in the clear is readable and recoverable;
//! a row sealed twice is neither.

use diesel::prelude::*;

use crate::db::schema::{
    attachments, global_placeholders, note_items, note_placeholders, notes, spaces,
};
use crate::error::StorageError;
use crate::vault::key::Vault;

/// How many rows carried plaintext, so a caller can say what happened.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Sealed {
    pub notes: usize,
    pub spaces: usize,
    pub items: usize,
    pub values: usize,
    pub attachments: usize,
}

impl Sealed {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// ⚠️ Not idempotent, and it cannot be: a sealed value is bytes like any other, so there
/// is no telling one apart from a plaintext body that happens to be base64. The guard is
/// the key file — [`super::file::create`] refuses a library that already has one, and
/// this only ever runs on the launch that creates it.
pub fn seal_existing(
    connection: &mut SqliteConnection,
    vault: &Vault,
) -> Result<Sealed, StorageError> {
    connection.transaction(|connection| {
        let mut done = Sealed::default();

        for (id, title, content, source) in notes::table
            .select((notes::id, notes::title, notes::content, notes::source))
            .load::<(String, String, String, String)>(connection)?
        {
            diesel::update(notes::table.find(&id))
                .set((
                    notes::title.eq(vault.seal(&title)?),
                    notes::content.eq(vault.seal(&content)?),
                    notes::source.eq(vault.seal(&source)?),
                ))
                .execute(connection)?;
            done.notes += 1;
        }

        for (id, name) in spaces::table
            .select((spaces::id, spaces::name))
            .load::<(String, String)>(connection)?
        {
            diesel::update(spaces::table.find(&id))
                .set(spaces::name.eq(vault.seal(&name)?))
                .execute(connection)?;
            done.spaces += 1;
        }

        // ⚠️ Keyed on `(note_id, position)` and `(note_id, name)`, so the update has to
        // name both halves — `find` takes a single-column key and these have none.
        for (note_id, position, text) in note_items::table
            .select((note_items::note_id, note_items::position, note_items::text))
            .load::<(String, i32, String)>(connection)?
        {
            diesel::update(
                note_items::table
                    .filter(note_items::note_id.eq(&note_id))
                    .filter(note_items::position.eq(position)),
            )
            .set(note_items::text.eq(vault.seal(&text)?))
            .execute(connection)?;
            done.items += 1;
        }

        for (note_id, name, value) in note_placeholders::table
            .select((
                note_placeholders::note_id,
                note_placeholders::name,
                note_placeholders::value,
            ))
            .load::<(String, String, String)>(connection)?
        {
            diesel::update(
                note_placeholders::table
                    .filter(note_placeholders::note_id.eq(&note_id))
                    .filter(note_placeholders::name.eq(&name)),
            )
            .set(note_placeholders::value.eq(vault.seal(&value)?))
            .execute(connection)?;
            done.values += 1;
        }

        for (name, value) in global_placeholders::table
            .select((global_placeholders::name, global_placeholders::value))
            .load::<(String, String)>(connection)?
        {
            diesel::update(global_placeholders::table.find(&name))
                .set(global_placeholders::value.eq(vault.seal(&value)?))
                .execute(connection)?;
            done.values += 1;
        }

        for (id, file_name) in attachments::table
            .select((attachments::id, attachments::file_name))
            .load::<(String, String)>(connection)?
        {
            diesel::update(attachments::table.find(&id))
                .set(attachments::file_name.eq(vault.seal(&file_name)?))
                .execute(connection)?;
            done.attachments += 1;
        }

        Ok(done)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::notes::store as note_store;
    use crate::spaces::store as space_store;

    fn plaintext_library() -> db::Library {
        // ⚠️ Built through the sealing stores, then un-sealed by hand below: there is no
        // way left in the crate to write a plaintext row, which is the point.
        db::open_in_memory().expect("a library")
    }

    /// Writes the columns back as they read, which is what a library from before
    /// encryption looks like.
    fn unseal_in_place(library: &mut db::Library) {
        let (connection, vault) = library.split();
        let rows = notes::table
            .select((notes::id, notes::title, notes::content, notes::source))
            .load::<(String, String, String, String)>(connection)
            .unwrap();
        let opened: Vec<_> = rows
            .into_iter()
            .map(|(id, title, content, source)| {
                (
                    id,
                    vault.open(&title).unwrap(),
                    vault.open(&content).unwrap(),
                    vault.open(&source).unwrap(),
                )
            })
            .collect();
        for (id, title, content, source) in opened {
            diesel::update(notes::table.find(&id))
                .set((
                    notes::title.eq(title),
                    notes::content.eq(content),
                    notes::source.eq(source),
                ))
                .execute(connection)
                .unwrap();
        }

        let spaces_rows = spaces::table
            .select((spaces::id, spaces::name))
            .load::<(String, String)>(connection)
            .unwrap();
        let opened: Vec<_> = spaces_rows
            .into_iter()
            .map(|(id, name)| (id, vault.open(&name).unwrap()))
            .collect();
        for (id, name) in opened {
            diesel::update(spaces::table.find(&id))
                .set(spaces::name.eq(name))
                .execute(connection)
                .unwrap();
        }
    }

    #[test]
    fn a_plaintext_library_reads_back_whole_once_sealed() {
        let mut library = plaintext_library();
        let space = space_store::create(&mut library, "Secrets").unwrap().id;
        let draft = crate::notes::model::NoteDraft {
            space_id: space.clone(),
            title: "AWS prod".to_string(),
            language: crate::notes::language::Language::Txt,
            content: "hunter2".to_string(),
            source: String::new(),
            tags: Vec::new(),
            pinned: false,
            lifecycle: crate::notes::model::NoteLifecycle::Permanent,
            kind: crate::notes::checklist::NoteKind::Snippet,
            items: Vec::new(),
        };
        let created = note_store::create(
            &mut library,
            draft,
            crate::notes::fixtures::at(crate::notes::fixtures::NOW),
        )
        .unwrap()
        .id;
        unseal_in_place(&mut library);

        let done = {
            let (connection, vault) = library.split();
            seal_existing(connection, vault).unwrap()
        };

        assert_eq!(done.notes, 1);
        assert_eq!(done.spaces, 1);

        let read_back = note_store::by_ids(&mut library, &[created]).unwrap();
        assert_eq!(read_back[0].title, "AWS prod");
        assert_eq!(read_back[0].content, "hunter2");
        assert_eq!(space_store::list(&mut library).unwrap()[0].name, "Secrets");
    }

    #[test]
    fn an_empty_library_seals_nothing_and_says_so() {
        let mut library = plaintext_library();

        let done = {
            let (connection, vault) = library.split();
            seal_existing(connection, vault).unwrap()
        };

        assert!(done.is_empty());
    }
}
