//! Lecture et écriture des notes.
//!
//! Fonctions ordinaires prenant une `&Connection` : les `#[tauri::command]` de
//! `commands/notes.rs` ne font que les appeler. Voir `storage/mod.rs`.
//!
//! L'horodatage n'est jamais lu ici depuis l'horloge système : il est passé en
//! paramètre (`now`), ce qui rend les écritures reproductibles en test.

use std::collections::HashMap;

use rusqlite::{Connection, Row};
use uuid::Uuid;

use super::{spaces, StorageError};
use crate::commands::notes::{Note, NoteDraft, NoteLifecycle, NotePatch};

const NOTE_COLUMNS: &str = "id, space_id, title, language, content, source, pinned, \
                            created_at, updated_at, lifecycle_kind, lifecycle_expires_at";

/// Reconstruit une note **sans ses tags** : ils vivent dans `note_tags` et sont
/// rattachés ensuite, en une seule requête pour toute la liste (cf. [`list`]).
fn row_to_note(row: &Row<'_>) -> rusqlite::Result<Note> {
    let lifecycle_kind: String = row.get("lifecycle_kind")?;
    let expires_at: Option<String> = row.get("lifecycle_expires_at")?;

    // La contrainte CHECK du schéma garantit que « expires » implique une date :
    // le cas `("expires", None)` est donc inatteignable, pas un cas dégradé.
    let lifecycle = match (lifecycle_kind.as_str(), expires_at) {
        ("expires", Some(at)) => NoteLifecycle::Expires { at },
        _ => NoteLifecycle::Permanent,
    };

    Ok(Note {
        id: row.get("id")?,
        space_id: row.get("space_id")?,
        title: row.get("title")?,
        language: row.get("language")?,
        content: row.get("content")?,
        source: row.get("source")?,
        tags: Vec::new(),
        pinned: row.get("pinned")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        lifecycle,
    })
}

fn lifecycle_columns(lifecycle: &NoteLifecycle) -> (&'static str, Option<&str>) {
    match lifecycle {
        NoteLifecycle::Permanent => ("permanent", None),
        NoteLifecycle::Expires { at } => ("expires", Some(at.as_str())),
    }
}

/// Tags de toutes les notes, en une requête — la version naïve ferait une
/// requête par note et le coût deviendrait visible dès quelques centaines.
fn all_tags(connection: &Connection) -> Result<HashMap<String, Vec<String>>, StorageError> {
    let mut statement = connection.prepare("SELECT note_id, tag FROM note_tags ORDER BY tag")?;
    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();

    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>("note_id")?, row.get::<_, String>("tag")?))
    })?;
    for row in rows {
        let (note_id, tag) = row?;
        grouped.entry(note_id).or_default().push(tag);
    }

    Ok(grouped)
}

fn tags_of(connection: &Connection, note_id: &str) -> Result<Vec<String>, StorageError> {
    let mut statement =
        connection.prepare("SELECT tag FROM note_tags WHERE note_id = ?1 ORDER BY tag")?;
    let tags = statement
        .query_map([note_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(tags)
}

/// Remplace intégralement les tags d'une note. Appelée uniquement quand le patch
/// porte un `tags` : un patch sans ce champ ne doit rien toucher.
fn replace_tags(connection: &Connection, note_id: &str, tags: &[String]) -> Result<(), StorageError> {
    connection.execute("DELETE FROM note_tags WHERE note_id = ?1", [note_id])?;

    let mut statement =
        connection.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?1, ?2)")?;
    for tag in tags {
        statement.execute((note_id, tag))?;
    }

    Ok(())
}

/// Toutes les notes, tous espaces confondus.
///
/// Le filtrage par espace, la recherche et les tags sont aujourd'hui appliqués
/// côté front, qui doit aussi pouvoir afficher « tous les espaces ». Le tri
/// décidé ici est donc celui que l'utilisateur voit à l'intérieur de chaque
/// section : le front conserve l'ordre reçu.
///
/// Une liste vide est une réponse valide (premier lancement).
pub fn list(connection: &Connection) -> Result<Vec<Note>, StorageError> {
    let mut tags = all_tags(connection)?;

    let mut statement = connection
        .prepare(&format!("SELECT {NOTE_COLUMNS} FROM notes ORDER BY updated_at DESC, id"))?;
    let mut notes = statement
        .query_map([], row_to_note)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    for note in &mut notes {
        note.tags = tags.remove(&note.id).unwrap_or_default();
    }

    Ok(notes)
}

fn find(connection: &Connection, id: &str) -> Result<Option<Note>, StorageError> {
    let mut statement =
        connection.prepare(&format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1"))?;
    let mut rows = statement.query_map([id], row_to_note)?;

    let Some(note) = rows.next().transpose()? else {
        return Ok(None);
    };
    drop(rows);

    Ok(Some(Note {
        tags: tags_of(connection, id)?,
        ..note
    }))
}

/// Crée une note et renvoie sa version persistée — identifiant définitif et
/// horodatages compris. Le store front remplace sa copie locale par cette
/// valeur : ce qui est renvoyé ici est ce que l'utilisateur voit.
pub fn create(
    connection: &mut Connection,
    draft: &NoteDraft,
    now: &str,
) -> Result<Note, StorageError> {
    let transaction = connection.transaction()?;

    if !spaces::exists(&transaction, &draft.space_id)? {
        return Err(StorageError::SpaceNotFound(draft.space_id.clone()));
    }

    let note = Note {
        id: Uuid::new_v4().to_string(),
        space_id: draft.space_id.clone(),
        title: draft.title.clone(),
        language: draft.language.clone(),
        content: draft.content.clone(),
        source: draft.source.clone(),
        tags: draft.tags.clone(),
        pinned: draft.pinned,
        created_at: now.to_string(),
        updated_at: now.to_string(),
        lifecycle: draft.lifecycle.clone(),
    };

    let (lifecycle_kind, expires_at) = lifecycle_columns(&note.lifecycle);
    transaction.execute(
        &format!(
            "INSERT INTO notes ({NOTE_COLUMNS}) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
        ),
        rusqlite::params![
            &note.id,
            &note.space_id,
            &note.title,
            &note.language,
            &note.content,
            &note.source,
            note.pinned,
            &note.created_at,
            &note.updated_at,
            lifecycle_kind,
            expires_at,
        ],
    )?;
    replace_tags(&transaction, &note.id, &note.tags)?;

    transaction.commit()?;

    Ok(note)
}

/// Applique **uniquement** les champs renseignés du patch, rafraîchit
/// `updated_at` et renvoie la note mise à jour.
///
/// Un `None` signifie « ne pas toucher » et ne doit jamais écraser la valeur
/// stockée : c'est ce que garantit le lire-modifier-écrire ci-dessous, exécuté
/// dans une transaction pour qu'une commande concurrente ne s'intercale pas.
///
/// Identifiant inconnu ⇒ `Err`, jamais un `Ok` silencieux : le front s'en sert
/// pour annuler sa mise à jour optimiste.
pub fn update(
    connection: &mut Connection,
    id: &str,
    patch: &NotePatch,
    now: &str,
) -> Result<Note, StorageError> {
    let transaction = connection.transaction()?;

    let Some(mut note) = find(&transaction, id)? else {
        return Err(StorageError::NoteNotFound(id.to_string()));
    };

    if let Some(space_id) = &patch.space_id {
        if !spaces::exists(&transaction, space_id)? {
            return Err(StorageError::SpaceNotFound(space_id.clone()));
        }
        note.space_id = space_id.clone();
    }
    if let Some(title) = &patch.title {
        note.title = title.clone();
    }
    if let Some(language) = &patch.language {
        note.language = language.clone();
    }
    if let Some(content) = &patch.content {
        note.content = content.clone();
    }
    if let Some(source) = &patch.source {
        note.source = source.clone();
    }
    if let Some(pinned) = patch.pinned {
        note.pinned = pinned;
    }
    if let Some(lifecycle) = &patch.lifecycle {
        note.lifecycle = lifecycle.clone();
    }
    note.updated_at = now.to_string();

    let (lifecycle_kind, expires_at) = lifecycle_columns(&note.lifecycle);
    transaction.execute(
        "UPDATE notes SET space_id = ?2, title = ?3, language = ?4, content = ?5, source = ?6, \
         pinned = ?7, updated_at = ?8, lifecycle_kind = ?9, lifecycle_expires_at = ?10 \
         WHERE id = ?1",
        rusqlite::params![
            &note.id,
            &note.space_id,
            &note.title,
            &note.language,
            &note.content,
            &note.source,
            note.pinned,
            &note.updated_at,
            lifecycle_kind,
            expires_at,
        ],
    )?;

    if let Some(tags) = &patch.tags {
        note.tags = tags.clone();
        replace_tags(&transaction, &note.id, &note.tags)?;
    }

    transaction.commit()?;

    Ok(note)
}

/// Supprime une note. Ses tags partent avec elle par cascade (d'où le
/// `PRAGMA foreign_keys = ON` de `storage::configure`).
///
/// Identifiant inconnu ⇒ `Err` : le front remet alors la note à sa place.
pub fn delete(connection: &Connection, id: &str) -> Result<(), StorageError> {
    let deleted = connection.execute("DELETE FROM notes WHERE id = ?1", [id])?;

    if deleted == 0 {
        return Err(StorageError::NoteNotFound(id.to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::spaces::SpaceDraft;
    use crate::storage::open_in_memory;

    const T0: &str = "2026-07-25T09:00:00.000Z";
    const T1: &str = "2026-07-25T10:00:00.000Z";

    fn space(connection: &Connection, name: &str) -> String {
        spaces::create(
            connection,
            &SpaceDraft {
                name: name.to_string(),
            },
        )
        .unwrap()
        .id
    }

    fn draft(space_id: &str) -> NoteDraft {
        NoteDraft {
            space_id: space_id.to_string(),
            title: "Titre".to_string(),
            language: "txt".to_string(),
            content: "Contenu".to_string(),
            source: "API Gateway / Auth".to_string(),
            tags: vec!["auth".to_string(), "api".to_string()],
            pinned: false,
            lifecycle: NoteLifecycle::Permanent,
        }
    }

    #[test]
    fn a_created_note_is_read_back_whole() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");

        let created = create(&mut connection, &draft(&space_id), T0).unwrap();
        let listed = list(&connection).unwrap();

        assert_eq!(listed.len(), 1);
        let note = &listed[0];
        assert_eq!(note.id, created.id);
        assert_eq!(note.space_id, space_id);
        assert_eq!(note.title, "Titre");
        assert_eq!(note.content, "Contenu");
        assert_eq!(note.source, "API Gateway / Auth");
        assert!(!note.pinned);
        // Tags come back sorted, not in insertion order.
        assert_eq!(note.tags, ["api", "auth"]);
    }

    #[test]
    fn creation_stamps_both_dates_identically() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");

        let created = create(&mut connection, &draft(&space_id), T0).unwrap();

        assert_eq!(created.created_at, T0);
        assert_eq!(created.updated_at, T0);
    }

    #[test]
    fn an_expiring_lifecycle_survives_a_round_trip() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let expiring = NoteDraft {
            lifecycle: NoteLifecycle::Expires {
                at: "2026-08-01T00:00:00.000Z".to_string(),
            },
            ..draft(&space_id)
        };

        create(&mut connection, &expiring, T0).unwrap();

        let listed = list(&connection).unwrap();
        assert!(matches!(
            &listed[0].lifecycle,
            NoteLifecycle::Expires { at } if at == "2026-08-01T00:00:00.000Z"
        ));
    }

    #[test]
    fn creating_in_an_unknown_space_is_refused() {
        let mut connection = open_in_memory().unwrap();

        let error = create(&mut connection, &draft("inconnu"), T0).unwrap_err();

        assert!(matches!(error, StorageError::SpaceNotFound(_)));
        assert!(list(&connection).unwrap().is_empty());
    }

    #[test]
    fn notes_are_listed_most_recently_updated_first() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");

        let older = create(&mut connection, &draft(&space_id), T0).unwrap();
        let newer = create(&mut connection, &draft(&space_id), T1).unwrap();

        let ids: Vec<String> = list(&connection).unwrap().into_iter().map(|n| n.id).collect();

        assert_eq!(ids, [newer.id, older.id]);
    }

    #[test]
    fn an_absent_patch_field_leaves_the_stored_value_untouched() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let created = create(&mut connection, &draft(&space_id), T0).unwrap();

        let patch = NotePatch {
            title: Some("Nouveau titre".to_string()),
            ..NotePatch::default()
        };
        let updated = update(&mut connection, &created.id, &patch, T1).unwrap();

        assert_eq!(updated.title, "Nouveau titre");
        // Everything the patch did not mention must survive, tags included.
        assert_eq!(updated.content, "Contenu");
        assert_eq!(updated.source, "API Gateway / Auth");
        assert_eq!(updated.tags, ["api", "auth"]);
        assert!(matches!(updated.lifecycle, NoteLifecycle::Permanent));
    }

    #[test]
    fn updating_refreshes_updated_at_but_not_created_at() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let created = create(&mut connection, &draft(&space_id), T0).unwrap();

        let updated = update(&mut connection, &created.id, &NotePatch::default(), T1).unwrap();

        assert_eq!(updated.created_at, T0);
        assert_eq!(updated.updated_at, T1);
    }

    #[test]
    fn patching_tags_replaces_the_whole_set() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let created = create(&mut connection, &draft(&space_id), T0).unwrap();

        let patch = NotePatch {
            tags: Some(vec!["sql".to_string()]),
            ..NotePatch::default()
        };
        update(&mut connection, &created.id, &patch, T1).unwrap();

        assert_eq!(list(&connection).unwrap()[0].tags, ["sql"]);
    }

    #[test]
    fn patching_tags_to_an_empty_list_clears_them() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let created = create(&mut connection, &draft(&space_id), T0).unwrap();

        let patch = NotePatch {
            tags: Some(Vec::new()),
            ..NotePatch::default()
        };
        let updated = update(&mut connection, &created.id, &patch, T1).unwrap();

        assert!(updated.tags.is_empty());
        assert!(list(&connection).unwrap()[0].tags.is_empty());
    }

    #[test]
    fn a_note_can_be_moved_to_another_space() {
        let mut connection = open_in_memory().unwrap();
        let origin = space(&connection, "Perso");
        let destination = space(&connection, "Boulot");
        let created = create(&mut connection, &draft(&origin), T0).unwrap();

        let patch = NotePatch {
            space_id: Some(destination.clone()),
            ..NotePatch::default()
        };
        let updated = update(&mut connection, &created.id, &patch, T1).unwrap();

        assert_eq!(updated.space_id, destination);
    }

    #[test]
    fn moving_a_note_to_an_unknown_space_is_refused_and_changes_nothing() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let created = create(&mut connection, &draft(&space_id), T0).unwrap();

        let patch = NotePatch {
            space_id: Some("inconnu".to_string()),
            title: Some("Ne doit pas passer".to_string()),
            ..NotePatch::default()
        };
        let error = update(&mut connection, &created.id, &patch, T1).unwrap_err();

        assert!(matches!(error, StorageError::SpaceNotFound(_)));
        let note = &list(&connection).unwrap()[0];
        assert_eq!(note.space_id, space_id);
        assert_eq!(note.title, "Titre");
    }

    #[test]
    fn updating_an_unknown_note_reports_an_error() {
        let mut connection = open_in_memory().unwrap();

        let error = update(&mut connection, "inconnu", &NotePatch::default(), T1).unwrap_err();

        assert!(matches!(error, StorageError::NoteNotFound(_)));
    }

    #[test]
    fn deleting_removes_the_note_and_its_tags() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let created = create(&mut connection, &draft(&space_id), T0).unwrap();

        delete(&connection, &created.id).unwrap();

        assert!(list(&connection).unwrap().is_empty());
        let orphan_tags: i64 = connection
            .query_row("SELECT COUNT(*) FROM note_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(orphan_tags, 0);
    }

    #[test]
    fn deleting_an_unknown_note_reports_an_error() {
        let connection = open_in_memory().unwrap();

        let error = delete(&connection, "inconnu").unwrap_err();

        assert!(matches!(error, StorageError::NoteNotFound(_)));
    }

    #[test]
    fn deleting_a_space_takes_its_notes_with_it() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &draft(&space_id), T0).unwrap();

        connection
            .execute("DELETE FROM spaces WHERE id = ?1", [&space_id])
            .unwrap();

        // No command exposes this yet, but the cascade must already hold:
        // a note whose space is gone would be invisible and unreachable.
        assert!(list(&connection).unwrap().is_empty());
    }
}
