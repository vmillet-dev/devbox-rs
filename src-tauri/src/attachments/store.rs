use std::collections::HashMap;

use diesel::prelude::*;

use super::model::{self, Attachment};
use crate::count::saturating_u32;
use crate::db::iso8601;
use crate::db::schema::{attachments, notes};
use crate::error::StorageError;

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = attachments)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
struct AttachmentRow {
    id: String,
    note_id: String,
    file_name: String,
    mime_type: String,
    byte_size: i64,
    created_at: String,
}

impl TryFrom<AttachmentRow> for Attachment {
    type Error = StorageError;

    fn try_from(row: AttachmentRow) -> Result<Self, Self::Error> {
        let created_at = iso8601::parse(&row.created_at).map_err(|_| StorageError::CorruptRow {
            id: row.id.clone(),
            field: "createdAt",
        })?;

        Ok(Self {
            byte_size: saturating_u32(row.byte_size),
            id: row.id,
            note_id: row.note_id,
            file_name: row.file_name,
            mime_type: row.mime_type,
            created_at,
        })
    }
}

impl From<&Attachment> for AttachmentRow {
    fn from(attachment: &Attachment) -> Self {
        Self {
            id: attachment.id.clone(),
            note_id: attachment.note_id.clone(),
            file_name: attachment.file_name.clone(),
            mime_type: attachment.mime_type.clone(),
            byte_size: i64::from(attachment.byte_size),
            created_at: iso8601::format(attachment.created_at),
        }
    }
}

/// The note is checked here: the foreign key would refuse it too, but with an
/// SQLite message the front cannot translate.
pub fn create(
    connection: &mut SqliteConnection,
    attachment: &Attachment,
) -> Result<(), StorageError> {
    connection.transaction(|connection| {
        let known = notes::table
            .find(&attachment.note_id)
            .filter(notes::deleted_at.is_null())
            .select(notes::id)
            .first::<String>(connection)
            .optional()?
            .is_some();
        if !known {
            return Err(StorageError::NoteNotFound(attachment.note_id.clone()));
        }

        diesel::insert_into(attachments::table)
            .values(AttachmentRow::from(attachment))
            .execute(connection)?;

        Ok(())
    })
}

pub fn list(
    connection: &mut SqliteConnection,
    note_id: &str,
) -> Result<Vec<Attachment>, StorageError> {
    attachments::table
        .filter(attachments::note_id.eq(note_id))
        .select(AttachmentRow::as_select())
        .order((attachments::created_at.asc(), attachments::id.asc()))
        .load::<AttachmentRow>(connection)?
        .into_iter()
        .map(Attachment::try_from)
        .collect()
}

pub fn find(
    connection: &mut SqliteConnection,
    id: &str,
) -> Result<Option<Attachment>, StorageError> {
    attachments::table
        .find(id)
        .select(AttachmentRow::as_select())
        .first::<AttachmentRow>(connection)
        .optional()?
        .map(Attachment::try_from)
        .transpose()
}

pub fn delete(connection: &mut SqliteConnection, id: &str) -> Result<(), StorageError> {
    let deleted = diesel::delete(attachments::table.find(id)).execute(connection)?;

    if deleted == 0 {
        return Err(StorageError::AttachmentNotFound(id.to_string()));
    }

    Ok(())
}

/// Collected **before** a purge: the cascade takes the records, never the files.
pub fn stored_names_of(
    connection: &mut SqliteConnection,
    note_ids: &[String],
) -> Result<Vec<String>, StorageError> {
    if note_ids.is_empty() {
        return Ok(Vec::new());
    }

    Ok(attachments::table
        .filter(attachments::note_id.eq_any(note_ids))
        .select((attachments::id, attachments::file_name))
        .load::<(String, String)>(connection)?
        .iter()
        .map(|(id, file_name)| model::stored_name(id, file_name))
        .collect())
}

pub fn all_stored_names(connection: &mut SqliteConnection) -> Result<Vec<String>, StorageError> {
    Ok(attachments::table
        .select((attachments::id, attachments::file_name))
        .load::<(String, String)>(connection)?
        .iter()
        .map(|(id, file_name)| model::stored_name(id, file_name))
        .collect())
}

/// One note. [`counts`] answers for the whole corpus at once; reading the records
/// back only to call `.len()` on them was a row per attachment for a number.
pub fn count_for(connection: &mut SqliteConnection, note_id: &str) -> Result<u32, StorageError> {
    let total: i64 = attachments::table
        .filter(attachments::note_id.eq(note_id))
        .count()
        .get_result(connection)?;

    Ok(saturating_u32(total))
}

pub fn counts(connection: &mut SqliteConnection) -> Result<HashMap<String, u32>, StorageError> {
    let rows = attachments::table
        .group_by(attachments::note_id)
        .select((attachments::note_id, diesel::dsl::count_star()))
        .load::<(String, i64)>(connection)?;

    Ok(rows
        .into_iter()
        .map(|(note_id, count)| (note_id, saturating_u32(count)))
        .collect())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::db::open_in_memory;
    use crate::notes::checklist::NoteKind;
    use crate::notes::language::Language;
    use crate::notes::model::{NoteDraft, NoteLifecycle};

    fn note(connection: &mut SqliteConnection) -> String {
        let space = crate::spaces::store::create(connection, "Personal").unwrap();
        crate::notes::store::create(
            connection,
            NoteDraft {
                space_id: space.id,
                title: "T".to_string(),
                language: Language::Txt,
                content: String::new(),
                source: String::new(),
                tags: Vec::new(),
                pinned: false,
                lifecycle: NoteLifecycle::Permanent,
                kind: NoteKind::Snippet,
                items: Vec::new(),
            },
            Utc::now(),
        )
        .unwrap()
        .id
    }

    fn sample(id: &str, note_id: &str) -> Attachment {
        Attachment {
            id: id.to_string(),
            note_id: note_id.to_string(),
            file_name: "capture.png".to_string(),
            mime_type: "image/png".to_string(),
            byte_size: 12,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn an_attachment_is_read_back_whole() {
        let mut connection = open_in_memory().unwrap();
        let note_id = note(&mut connection);

        create(&mut connection, &sample("a-1", &note_id)).unwrap();
        let listed = list(&mut connection, &note_id).unwrap();

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_name, "capture.png");
        assert_eq!(listed[0].byte_size, 12);
    }

    #[test]
    fn attaching_to_an_unknown_note_is_refused() {
        let mut connection = open_in_memory().unwrap();

        let error = create(&mut connection, &sample("a-1", "ghost")).unwrap_err();

        assert!(matches!(error, StorageError::NoteNotFound(_)));
    }

    #[test]
    fn purging_a_note_takes_its_attachment_rows_with_it() {
        let mut connection = open_in_memory().unwrap();
        let note_id = note(&mut connection);
        create(&mut connection, &sample("a-1", &note_id)).unwrap();

        let files = stored_names_of(&mut connection, std::slice::from_ref(&note_id)).unwrap();
        crate::notes::store::trash::trash(&mut connection, &note_id, Utc::now()).unwrap();
        crate::notes::store::trash::purge(&mut connection, std::slice::from_ref(&note_id)).unwrap();

        assert_eq!(files, ["a-1.png"]);
        assert!(list(&mut connection, &note_id).unwrap().is_empty());
    }
}
