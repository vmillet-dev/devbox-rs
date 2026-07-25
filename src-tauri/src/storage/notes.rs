//! Lecture et écriture des notes.
//!
//! Fonctions ordinaires prenant une `&Connection` : les `#[tauri::command]` de
//! `commands/notes.rs` ne font que les appeler. Voir `storage/mod.rs`.
//!
//! L'horodatage n'est jamais lu ici depuis l'horloge système : il est passé en
//! paramètre (`now`), ce qui rend les écritures reproductibles en test.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, Row, ToSql};
use uuid::Uuid;

use super::{sections, spaces, StorageError};
use crate::commands::notes::{
    Note, NoteDraft, NoteFilter, NoteLifecycle, NotePatch, NotesQuery, NotesView,
};

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

/// Nettoie les tags avant écriture : espaces, `#` de tête, vides et doublons.
///
/// La déduplication est **insensible à la casse** et garde la première graphie
/// rencontrée. Sans elle, `urgent` et `URGENT` produiraient deux entrées dans le
/// rail alors qu'ils désignent la même chose pour l'utilisateur.
///
/// C'est le seul endroit où cette règle vit : le front envoie ce que
/// l'utilisateur a tapé, tel quel.
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut normalized: Vec<String> = Vec::new();

    for tag in tags {
        let cleaned = tag.trim().trim_start_matches('#').trim();
        if cleaned.is_empty() {
            continue;
        }

        let folded = cleaned.to_lowercase();
        if seen.contains(&folded) {
            continue;
        }

        seen.push(folded);
        normalized.push(cleaned.to_string());
    }

    normalized
}

/// Remplace intégralement les tags d'une note. Appelée uniquement quand le patch
/// porte un `tags` : un patch sans ce champ ne doit rien toucher.
///
/// Renvoie les tags réellement écrits, qui peuvent différer de ceux reçus
/// (cf. [`normalize_tags`]) : l'appelant doit adopter cette valeur, sinon il
/// renverrait au front une note qui ne correspond pas à la base.
///
/// Le tri final aligne l'écriture sur la lecture (`ORDER BY tag`) : sans lui,
/// une note fraîchement enregistrée afficherait ses tags dans un ordre, puis
/// dans un autre au rechargement suivant.
fn replace_tags(
    connection: &Connection,
    note_id: &str,
    tags: &[String],
) -> Result<Vec<String>, StorageError> {
    let mut normalized = normalize_tags(tags);

    connection.execute("DELETE FROM note_tags WHERE note_id = ?1", [note_id])?;

    let mut statement =
        connection.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?1, ?2)")?;
    for tag in &normalized {
        statement.execute((note_id, tag))?;
    }

    normalized.sort();

    Ok(normalized)
}

/// Toutes les notes, tous espaces confondus. **Réservée aux tests** : en
/// production tout passe par [`query`], qui filtre et regroupe. Exposer une
/// liste brute au front l'inviterait à refiltrer lui-même.
#[cfg(test)]
pub fn list(connection: &Connection) -> Result<Vec<Note>, StorageError> {
    query(
        connection,
        &NotesQuery {
            space_id: None,
            search: String::new(),
            filter: NoteFilter::All,
            tags: Vec::new(),
            now: "2026-07-25T09:00:00.000Z".to_string(),
            tz_offset_minutes: 0,
        },
    )
    .map(|view| view.sections.into_iter().flat_map(|s| s.notes).collect())
}

/// Une note correspond-elle au texte cherché ?
///
/// Le repliage de casse est fait **en Rust** et non en SQL : le `LOWER()` de
/// SQLite ne traite que l'ASCII (sans extension ICU), donc `Étape` ne
/// correspondrait pas à `étape`. `to_lowercase` est Unicode.
fn matches_search(note: &Note, needle: &str) -> bool {
    note.title.to_lowercase().contains(needle)
        || note.tags.iter().any(|tag| tag.to_lowercase().contains(needle))
        || note.content.to_lowercase().contains(needle)
}

/// Tags proposables par le rail, portés à l'espace et non au filtre courant :
/// ne proposer que les tags des notes déjà filtrées viderait le rail dès la
/// première sélection, rendant impossible d'en choisir un second.
fn available_tags(
    connection: &Connection,
    space_id: Option<&str>,
) -> Result<Vec<String>, StorageError> {
    let tags = match space_id {
        Some(id) => {
            let mut statement = connection.prepare(
                "SELECT DISTINCT tag FROM note_tags \
                 JOIN notes ON notes.id = note_tags.note_id \
                 WHERE notes.space_id = ?1 ORDER BY tag",
            )?;
            statement
                .query_map([id], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        }
        None => {
            let mut statement =
                connection.prepare("SELECT DISTINCT tag FROM note_tags ORDER BY tag")?;
            statement
                .query_map([], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        }
    };

    Ok(tags)
}

/// Vue complète : notes filtrées, réparties en sections, plus les tags du rail.
///
/// Le partage des tâches est délibéré :
/// - **SQL** pour ce qu'il indexe bien — espace, épinglage, cycle de vie, et
///   l'appartenance à un tag via `note_tags` ;
/// - **Rust** pour la recherche texte, qui demande un repliage de casse
///   Unicode (cf. [`matches_search`]) ;
/// - [`sections`] pour le regroupement, qui ne touche pas à la base.
///
/// Une vue sans aucune note est une réponse valide (premier lancement, ou
/// recherche infructueuse — `is_filtering` permet de distinguer les deux).
pub fn query(connection: &Connection, request: &NotesQuery) -> Result<NotesView, StorageError> {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();

    if let Some(space_id) = &request.space_id {
        params.push(Box::new(space_id.clone()));
        conditions.push(format!("space_id = ?{}", params.len()));
    }

    match request.filter {
        NoteFilter::All => {}
        NoteFilter::Pinned => conditions.push("pinned = 1".to_string()),
        NoteFilter::Untriaged => conditions.push("lifecycle_kind = 'expires'".to_string()),
    }

    // Les tags reçus passent par la même normalisation que ceux écrits, sinon
    // un `#urgent` saisi au clavier ne retrouverait pas le tag `urgent` stocké.
    let selected_tags = normalize_tags(&request.tags);
    if !selected_tags.is_empty() {
        let placeholders: Vec<String> = selected_tags
            .iter()
            .map(|tag| {
                params.push(Box::new(tag.clone()));
                format!("?{}", params.len())
            })
            .collect();
        // « au moins un tag », pas « tous » : c'est le comportement d'un rail de facettes.
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM note_tags WHERE note_id = notes.id AND tag IN ({}))",
            placeholders.join(", ")
        ));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };

    // Le tri est décidé ici, une fois : le front conserve l'ordre reçu.
    let mut statement = connection.prepare(&format!(
        "SELECT {NOTE_COLUMNS} FROM notes{where_clause} ORDER BY updated_at DESC, id"
    ))?;
    let bound: Vec<&dyn ToSql> = params.iter().map(|param| param.as_ref()).collect();
    let mut notes = statement
        .query_map(bound.as_slice(), row_to_note)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut tags = all_tags(connection)?;
    for note in &mut notes {
        note.tags = tags.remove(&note.id).unwrap_or_default();
    }

    // Après le rattachement des tags : la recherche porte aussi sur eux.
    let needle = request.search.trim().to_lowercase();
    if !needle.is_empty() {
        notes.retain(|note| matches_search(note, &needle));
    }

    // Le filtre rapide (épinglées / à trier) ne bascule pas en mode résultats :
    // il restreint une vue qui reste chronologique.
    let is_filtering = !needle.is_empty() || !selected_tags.is_empty();
    let matched = notes.len();

    let offset = sections::offset_from_minutes(request.tz_offset_minutes);
    let now = DateTime::parse_from_rfc3339(&request.now)
        .map(|instant| instant.with_timezone(&offset))
        .unwrap_or_else(|_| Utc::now().with_timezone(&offset));

    Ok(NotesView {
        sections: sections::build(notes, is_filtering, &now, &offset),
        available_tags: available_tags(connection, request.space_id.as_deref())?,
        is_filtering,
        matched,
    })
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

    let mut note = Note {
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
    // La note renvoyée doit refléter ce qui est réellement en base : les tags
    // écrits sont normalisés, pas ceux du brouillon.
    note.tags = replace_tags(&transaction, &note.id, &draft.tags)?;

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
        note.tags = replace_tags(&transaction, &note.id, tags)?;
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

    /// Neutral query: everything, no search, no tags. Tests override one field
    /// at a time so each one states exactly what it exercises.
    fn all_notes() -> NotesQuery {
        NotesQuery {
            space_id: None,
            search: String::new(),
            filter: NoteFilter::All,
            tags: Vec::new(),
            now: T1.to_string(),
            tz_offset_minutes: 0,
        }
    }

    fn matched_ids(view: &NotesView) -> Vec<String> {
        view.sections
            .iter()
            .flat_map(|section| section.notes.iter().map(|note| note.id.clone()))
            .collect()
    }

    fn tagged(space_id: &str, tags: &[&str]) -> NoteDraft {
        NoteDraft {
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
            ..draft(space_id)
        }
    }

    #[test]
    fn a_query_without_criteria_returns_every_note() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &draft(&space_id), T0).unwrap();

        let view = query(&connection, &all_notes()).unwrap();

        assert_eq!(view.matched, 1);
        assert!(!view.is_filtering);
    }

    #[test]
    fn the_space_filter_excludes_the_other_spaces() {
        let mut connection = open_in_memory().unwrap();
        let here = space(&connection, "Perso");
        let elsewhere = space(&connection, "Boulot");
        let kept = create(&mut connection, &draft(&here), T0).unwrap();
        create(&mut connection, &draft(&elsewhere), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                space_id: Some(here),
                ..all_notes()
            },
        )
        .unwrap();

        assert_eq!(matched_ids(&view), [kept.id]);
    }

    #[test]
    fn no_space_means_every_space_rather_than_none() {
        let mut connection = open_in_memory().unwrap();
        let here = space(&connection, "Perso");
        let elsewhere = space(&connection, "Boulot");
        create(&mut connection, &draft(&here), T0).unwrap();
        create(&mut connection, &draft(&elsewhere), T0).unwrap();

        let view = query(&connection, &all_notes()).unwrap();

        assert_eq!(view.matched, 2);
    }

    #[test]
    fn the_pinned_filter_keeps_only_pinned_notes() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let pinned = create(
            &mut connection,
            &NoteDraft {
                pinned: true,
                ..draft(&space_id)
            },
            T0,
        )
        .unwrap();
        create(&mut connection, &draft(&space_id), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                filter: NoteFilter::Pinned,
                ..all_notes()
            },
        )
        .unwrap();

        assert_eq!(matched_ids(&view), [pinned.id]);
    }

    #[test]
    fn the_untriaged_filter_keeps_only_expiring_notes() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let expiring = create(
            &mut connection,
            &NoteDraft {
                lifecycle: NoteLifecycle::Expires {
                    at: "2026-08-01T00:00:00.000Z".to_string(),
                },
                ..draft(&space_id)
            },
            T0,
        )
        .unwrap();
        create(&mut connection, &draft(&space_id), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                filter: NoteFilter::Untriaged,
                ..all_notes()
            },
        )
        .unwrap();

        assert_eq!(matched_ids(&view), [expiring.id]);
    }

    #[test]
    fn a_quick_filter_alone_does_not_switch_to_results_mode() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &draft(&space_id), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                filter: NoteFilter::Pinned,
                ..all_notes()
            },
        )
        .unwrap();

        // Pinned/untriaged narrow a view that stays chronological; only a search
        // or a tag selection collapses it into a flat result list.
        assert!(!view.is_filtering);
    }

    #[test]
    fn the_search_matches_the_title_the_content_and_the_tags() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let by_title = create(
            &mut connection,
            &NoteDraft {
                title: "Script de deploiement".to_string(),
                content: String::new(),
                tags: Vec::new(),
                ..draft(&space_id)
            },
            T0,
        )
        .unwrap();
        let by_content = create(
            &mut connection,
            &NoteDraft {
                title: String::new(),
                content: "kubectl rollout".to_string(),
                tags: Vec::new(),
                ..draft(&space_id)
            },
            T0,
        )
        .unwrap();
        let by_tag = create(&mut connection, &tagged(&space_id, &["urgent"]), T0).unwrap();

        for (needle, expected) in [
            ("deploiement", &by_title),
            ("rollout", &by_content),
            ("urgent", &by_tag),
        ] {
            let view = query(
                &connection,
                &NotesQuery {
                    search: needle.to_string(),
                    ..all_notes()
                },
            )
            .unwrap();
            assert_eq!(matched_ids(&view), [expected.id.clone()], "needle: {needle}");
        }
    }

    #[test]
    fn the_search_ignores_case_beyond_ascii() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(
            &mut connection,
            &NoteDraft {
                title: "Étape de migration".to_string(),
                ..draft(&space_id)
            },
            T0,
        )
        .unwrap();

        // SQLite's LOWER() only folds ASCII, so "É" would never match "é" if the
        // search were pushed into SQL. This is why it is done in Rust.
        let view = query(
            &connection,
            &NotesQuery {
                search: "étape".to_string(),
                ..all_notes()
            },
        )
        .unwrap();

        assert_eq!(view.matched, 1);
    }

    #[test]
    fn a_blank_search_is_not_a_search() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &draft(&space_id), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                search: "   ".to_string(),
                ..all_notes()
            },
        )
        .unwrap();

        assert!(!view.is_filtering);
        assert_eq!(view.matched, 1);
    }

    #[test]
    fn a_note_matches_when_it_carries_at_least_one_selected_tag() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let one = create(&mut connection, &tagged(&space_id, &["urgent"]), T0).unwrap();
        let two = create(&mut connection, &tagged(&space_id, &["later"]), T0).unwrap();
        create(&mut connection, &tagged(&space_id, &["neither"]), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                tags: vec!["urgent".to_string(), "later".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        // A facet rail is a union, not an intersection: requiring every tag
        // would make a second selection almost always empty.
        let ids = matched_ids(&view);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&one.id) && ids.contains(&two.id));
        assert!(view.is_filtering);
    }

    #[test]
    fn a_selected_tag_is_normalised_like_a_stored_one() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &tagged(&space_id, &["urgent"]), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                tags: vec![" #urgent ".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        assert_eq!(view.matched, 1);
    }

    #[test]
    fn criteria_combine_rather_than_replace_each_other() {
        let mut connection = open_in_memory().unwrap();
        let here = space(&connection, "Perso");
        let elsewhere = space(&connection, "Boulot");

        let target = create(
            &mut connection,
            &NoteDraft {
                title: "deploy".to_string(),
                pinned: true,
                tags: vec!["urgent".to_string()],
                ..draft(&here)
            },
            T0,
        )
        .unwrap();
        // Each of these fails exactly one criterion.
        create(
            &mut connection,
            &NoteDraft {
                title: "deploy".to_string(),
                pinned: true,
                tags: vec!["later".to_string()],
                ..draft(&here)
            },
            T0,
        )
        .unwrap();
        create(
            &mut connection,
            &NoteDraft {
                title: "deploy".to_string(),
                pinned: false,
                tags: vec!["urgent".to_string()],
                ..draft(&here)
            },
            T0,
        )
        .unwrap();
        create(
            &mut connection,
            &NoteDraft {
                title: "autre".to_string(),
                pinned: true,
                tags: vec!["urgent".to_string()],
                ..draft(&here)
            },
            T0,
        )
        .unwrap();
        create(
            &mut connection,
            &NoteDraft {
                title: "deploy".to_string(),
                pinned: true,
                tags: vec!["urgent".to_string()],
                ..draft(&elsewhere)
            },
            T0,
        )
        .unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                space_id: Some(here),
                search: "deploy".to_string(),
                filter: NoteFilter::Pinned,
                tags: vec!["urgent".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        assert_eq!(matched_ids(&view), [target.id]);
    }

    #[test]
    fn available_tags_are_sorted_and_de_duplicated() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &tagged(&space_id, &["zeta", "alpha"]), T0).unwrap();
        create(&mut connection, &tagged(&space_id, &["alpha", "beta"]), T0).unwrap();

        let view = query(&connection, &all_notes()).unwrap();

        assert_eq!(view.available_tags, ["alpha", "beta", "zeta"]);
    }

    #[test]
    fn available_tags_are_scoped_to_the_active_space() {
        let mut connection = open_in_memory().unwrap();
        let here = space(&connection, "Perso");
        let elsewhere = space(&connection, "Boulot");
        create(&mut connection, &tagged(&here, &["here-tag"]), T0).unwrap();
        create(&mut connection, &tagged(&elsewhere, &["elsewhere-tag"]), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                space_id: Some(here),
                ..all_notes()
            },
        )
        .unwrap();

        // Offering a tag that filters nothing in the current space is noise.
        assert_eq!(view.available_tags, ["here-tag"]);
    }

    #[test]
    fn available_tags_ignore_the_current_search_and_selection() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &tagged(&space_id, &["urgent"]), T0).unwrap();
        create(&mut connection, &tagged(&space_id, &["later"]), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                tags: vec!["urgent".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        // Narrowing the rail to the current results would empty it after the
        // first click and make a second selection impossible.
        assert_eq!(view.available_tags, ["later", "urgent"]);
        assert_eq!(view.matched, 1);
    }

    #[test]
    fn a_search_matching_nothing_reports_filtering_with_zero_matches() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &draft(&space_id), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                search: "introuvable".to_string(),
                ..all_notes()
            },
        )
        .unwrap();

        // The pair (is_filtering, matched) is what lets the UI say "no results"
        // rather than "this space is empty".
        assert!(view.is_filtering);
        assert_eq!(view.matched, 0);
    }

    #[test]
    fn the_view_orders_notes_most_recently_updated_first() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let older = create(&mut connection, &draft(&space_id), T0).unwrap();
        let newer = create(&mut connection, &draft(&space_id), T1).unwrap();

        let view = query(&connection, &all_notes()).unwrap();

        assert_eq!(matched_ids(&view), [newer.id, older.id]);
    }

    #[test]
    fn tags_are_normalised_on_write() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");

        let created = create(
            &mut connection,
            &tagged(&space_id, &["  #urgent ", "URGENT", "", " # ", "later"]),
            T0,
        )
        .unwrap();

        // Padding and leading hashes are stripped, blanks dropped, and the
        // case-insensitive duplicate collapses onto the first spelling.
        assert_eq!(created.tags, ["later", "urgent"]);
        assert_eq!(list(&connection).unwrap()[0].tags, ["later", "urgent"]);
    }

    #[test]
    fn a_normalised_write_returns_what_a_read_would_return() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");

        let created = create(&mut connection, &tagged(&space_id, &["zeta", "alpha"]), T0).unwrap();

        // The front adopts the returned note; a different order here would make
        // the tags jump around on the next reload.
        assert_eq!(created.tags, list(&connection).unwrap()[0].tags);
    }

    #[test]
    fn normalisation_keeps_the_first_spelling_of_a_duplicate() {
        assert_eq!(
            normalize_tags(&["Urgent".to_string(), "urgent".to_string()]),
            ["Urgent"]
        );
    }

    #[test]
    fn normalisation_strips_only_leading_hashes() {
        assert_eq!(
            normalize_tags(&["##c++".to_string(), "a#b".to_string()]),
            ["c++", "a#b"]
        );
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
