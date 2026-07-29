//! Lecture et écriture des notes : **du SQL, et rien d'autre**.
//!
//! Ne descendent dans le `WHERE` que les critères indexés par SQLite — espace,
//! épinglage, cycle de vie, langage, tag. Correspondance de recherche,
//! regroupement en sections et normalisation des tags sont des règles, et vivent
//! dans `crate::domain`.
//!
//! `now` est passé en paramètre plutôt que lu de l'horloge : les écritures
//! restent reproductibles en test.

use std::collections::HashMap;

use rusqlite::{Connection, Row, ToSql};
use uuid::Uuid;

use super::{StorageError, spaces};
use crate::domain::note::{Note, NoteDraft, NoteLifecycle, NotePatch};
use crate::domain::rules;
use crate::domain::view::{Facets, NoteFilter, NotesQuery};

const NOTE_COLUMNS: &str = "id, space_id, title, language, content, source, pinned, \
                            created_at, updated_at, lifecycle_kind, lifecycle_expires_at";

/// Note **sans ses tags** : ils vivent dans `note_tags` et sont rattachés
/// ensuite, en une requête pour toute la liste.
fn row_to_note(row: &Row<'_>) -> rusqlite::Result<Note> {
    let lifecycle_kind: String = row.get("lifecycle_kind")?;
    let expires_at: Option<String> = row.get("lifecycle_expires_at")?;

    // Le `CHECK` du schéma rend `("expires", None)` inatteignable.
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

/// Tags de toutes les notes en une requête ; une par note coûterait cher dès
/// quelques centaines.
fn all_tags(connection: &Connection) -> Result<HashMap<String, Vec<String>>, StorageError> {
    let mut statement = connection.prepare("SELECT note_id, tag FROM note_tags ORDER BY tag")?;
    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();

    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>("note_id")?,
            row.get::<_, String>("tag")?,
        ))
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

/// Remplace intégralement les tags, uniquement quand le patch en porte.
///
/// Renvoie les tags **réellement écrits**, qui peuvent différer de ceux reçus :
/// l'appelant doit adopter cette valeur, sinon il rendrait au front une note qui
/// ne correspond pas à la base. Le tri final aligne l'écriture sur la lecture,
/// sans quoi les tags se réordonneraient au rechargement suivant.
fn replace_tags(
    connection: &Connection,
    note_id: &str,
    requested: &[String],
) -> Result<Vec<String>, StorageError> {
    let mut normalized = rules::normalize_tags(requested);

    connection.execute("DELETE FROM note_tags WHERE note_id = ?1", [note_id])?;

    let mut statement =
        connection.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?1, ?2)")?;
    for tag in &normalized {
        statement.execute((note_id, tag))?;
    }

    normalized.sort();

    Ok(normalized)
}

/// **Réservée aux tests** : en production tout passe par [`fetch`] puis
/// `domain::view::build`.
#[cfg(test)]
pub fn list(connection: &Connection) -> Result<Vec<Note>, StorageError> {
    fetch(
        connection,
        &NotesQuery {
            space_id: None,
            search: String::new(),
            filter: NoteFilter::All,
            tags: Vec::new(),
            languages: Vec::new(),
            now: "2026-07-25T09:00:00.000Z".to_string(),
            tz_offset_minutes: 0,
        },
    )
    .map(|(notes, _)| notes)
}

/// Lie `values` et rend la liste de placeholders correspondante (`?3, ?4`).
/// Les numéros suivent `params`, qui peut déjà porter d'autres critères.
fn placeholders(values: &[String], params: &mut Vec<Box<dyn ToSql>>) -> String {
    values
        .iter()
        .map(|value| {
            params.push(Box::new(value.clone()));
            format!("?{}", params.len())
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Valeurs distinctes d'une colonne, portées à un espace. Sert les deux rails de
/// facettes, qui posent la même question à deux colonnes près.
fn distinct(
    connection: &Connection,
    unscoped: &str,
    scoped: &str,
    space_id: Option<&str>,
) -> Result<Vec<String>, StorageError> {
    let values = match space_id {
        Some(id) => {
            let mut statement = connection.prepare(scoped)?;
            statement
                .query_map([id], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        }
        None => {
            let mut statement = connection.prepare(unscoped)?;
            statement
                .query_map([], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        }
    };

    Ok(values)
}

/// Facettes proposables par les rails, portées à l'espace et non au filtre
/// courant : ne proposer que celles des notes déjà filtrées viderait les rails
/// dès la première sélection, rendant impossible d'en choisir une seconde.
fn facets(connection: &Connection, space_id: Option<&str>) -> Result<Facets, StorageError> {
    Ok(Facets {
        tags: distinct(
            connection,
            "SELECT DISTINCT tag FROM note_tags ORDER BY tag",
            "SELECT DISTINCT tag FROM note_tags \
             JOIN notes ON notes.id = note_tags.note_id \
             WHERE notes.space_id = ?1 ORDER BY tag",
            space_id,
        )?,
        languages: distinct(
            connection,
            "SELECT DISTINCT language FROM notes ORDER BY language",
            "SELECT DISTINCT language FROM notes WHERE space_id = ?1 ORDER BY language",
            space_id,
        )?,
    })
}

/// Notes retenues par les critères **grossiers**, et facettes des rails.
/// `domain::view::build` prend le relais pour la recherche texte et les sections.
pub fn fetch(
    connection: &Connection,
    request: &NotesQuery,
) -> Result<(Vec<Note>, Facets), StorageError> {
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

    // Pas de normalisation, contrairement aux tags : un langage est choisi dans
    // une liste fermée, et une valeur inconnue ne correspond à rien — c'est le
    // résultat attendu.
    if !request.languages.is_empty() {
        // Union, comme les tags : sélectionner JSON puis YAML montre les deux.
        let bound = placeholders(&request.languages, &mut params);
        conditions.push(format!("language IN ({bound})"));
    }

    // Même normalisation qu'à l'écriture, sinon un `#urgent` saisi au clavier ne
    // retrouverait pas le tag `urgent` stocké.
    let selected_tags = rules::normalize_tags(&request.tags);
    if !selected_tags.is_empty() {
        // « au moins un tag », pas « tous » : comportement d'un rail de facettes.
        let bound = placeholders(&selected_tags, &mut params);
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM note_tags WHERE note_id = notes.id AND tag IN ({bound}))"
        ));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };

    // Tri décidé ici une fois pour toutes ; le front conserve l'ordre reçu.
    // Sur `updated_at` alors que les sections regroupent sur `created_at` :
    // la section dit quand la note est née, l'ordre interne laquelle a été
    // touchée en dernier.
    let mut statement = connection.prepare(&format!(
        "SELECT {NOTE_COLUMNS} FROM notes{where_clause} ORDER BY updated_at DESC, id"
    ))?;
    let bound: Vec<&dyn ToSql> = params.iter().map(|param| param.as_ref()).collect();
    let mut notes = statement
        .query_map(bound.as_slice(), row_to_note)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Rattachés avant de rendre la main : la recherche du domaine porte dessus.
    let mut grouped = all_tags(connection)?;
    for note in &mut notes {
        note.tags = grouped.remove(&note.id).unwrap_or_default();
    }

    Ok((notes, facets(connection, request.space_id.as_deref())?))
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

/// Renvoie la version persistée — identifiant définitif et horodatages compris.
/// Le front adopte cette valeur telle quelle.
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
    // Les tags écrits sont normalisés, pas ceux du brouillon.
    note.tags = replace_tags(&transaction, &note.id, &draft.tags)?;

    transaction.commit()?;

    Ok(note)
}

/// Applique **uniquement** les champs renseignés du patch et rafraîchit
/// `updated_at`. Un `None` signifie « ne pas toucher » — d'où le
/// lire-modifier-écrire, en transaction pour qu'aucune commande ne s'intercale.
///
/// Identifiant inconnu ⇒ `Err` : le front croirait sinon avoir enregistré.
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

/// Ses tags partent par cascade (d'où le `PRAGMA foreign_keys = ON` de
/// `storage::configure`). Identifiant inconnu ⇒ `Err`.
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
    use crate::domain::view;
    use crate::domain::view::NotesView;
    use crate::storage::open_in_memory;

    const T0: &str = "2026-07-25T09:00:00.000Z";
    const T1: &str = "2026-07-25T10:00:00.000Z";

    /// Chemin de lecture complet — SQL puis règles — tel que `query_notes`
    /// l'assemble. Les règles ont leurs propres tests dans `domain/` ; ici on
    /// vérifie qu'elles s'appliquent bien à ce que la base a réellement rendu.
    fn query(connection: &Connection, request: &NotesQuery) -> Result<NotesView, StorageError> {
        let (notes, facets) = fetch(connection, request)?;
        Ok(view::build(notes, facets, request).expect("les tests fournissent un instant valide"))
    }

    fn space(connection: &Connection, name: &str) -> String {
        spaces::create(connection, name).unwrap().id
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

        let ids: Vec<String> = list(&connection)
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect();

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
            languages: Vec::new(),
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

    fn written_in(space_id: &str, language: &str) -> NoteDraft {
        NoteDraft {
            language: language.to_string(),
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
            assert_eq!(
                matched_ids(&view),
                [expected.id.as_str()],
                "needle: {needle}"
            );
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
    fn a_selected_tag_matches_a_stored_one_of_a_different_case() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &tagged(&space_id, &["Urgent"]), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                tags: vec!["urgent".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        // Without COLLATE NOCASE on note_tags.tag the IN (…) comparison runs in
        // BINARY and misses: the rail would offer a facet selecting nothing.
        assert_eq!(view.matched, 1);
    }

    #[test]
    fn the_rail_offers_one_facet_for_tags_differing_only_in_case() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &tagged(&space_id, &["Urgent"]), T0).unwrap();
        create(&mut connection, &tagged(&space_id, &["urgent"]), T1).unwrap();

        let view = query(&connection, &all_notes()).unwrap();

        // normalize_tags folds case within one note; the collation extends that
        // to the whole corpus, which is what the rail reads.
        assert_eq!(view.available_tags.len(), 1);
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
    fn a_note_matches_when_it_is_written_in_one_of_the_selected_languages() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let json = create(&mut connection, &written_in(&space_id, "json"), T0).unwrap();
        let yml = create(&mut connection, &written_in(&space_id, "yml"), T0).unwrap();
        create(&mut connection, &written_in(&space_id, "py"), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                languages: vec!["json".to_string(), "yml".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        // A union like the tag rail, not an intersection: a note has exactly one
        // language, so requiring all of them would always match nothing.
        let ids = matched_ids(&view);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&json.id) && ids.contains(&yml.id));
        assert!(view.is_filtering);
    }

    #[test]
    fn the_language_filter_combines_with_the_other_criteria() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        let target = create(
            &mut connection,
            &NoteDraft {
                title: "deploy".to_string(),
                ..written_in(&space_id, "yml")
            },
            T0,
        )
        .unwrap();
        // Same language, wrong search; and same search, wrong language.
        create(&mut connection, &written_in(&space_id, "yml"), T0).unwrap();
        create(
            &mut connection,
            &NoteDraft {
                title: "deploy".to_string(),
                ..written_in(&space_id, "json")
            },
            T0,
        )
        .unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                search: "deploy".to_string(),
                languages: vec!["yml".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        assert_eq!(matched_ids(&view), [target.id]);
    }

    #[test]
    fn an_unknown_selected_language_matches_nothing_rather_than_everything() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &written_in(&space_id, "json"), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                languages: vec!["cobol".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        assert_eq!(view.matched, 0);
    }

    #[test]
    fn available_languages_are_sorted_and_de_duplicated() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &written_in(&space_id, "yml"), T0).unwrap();
        create(&mut connection, &written_in(&space_id, "json"), T0).unwrap();
        create(&mut connection, &written_in(&space_id, "json"), T1).unwrap();

        let view = query(&connection, &all_notes()).unwrap();

        assert_eq!(view.available_languages, ["json", "yml"]);
    }

    #[test]
    fn available_languages_are_scoped_to_the_active_space() {
        let mut connection = open_in_memory().unwrap();
        let here = space(&connection, "Perso");
        let elsewhere = space(&connection, "Boulot");
        create(&mut connection, &written_in(&here, "json"), T0).unwrap();
        create(&mut connection, &written_in(&elsewhere, "sql"), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                space_id: Some(here),
                ..all_notes()
            },
        )
        .unwrap();

        // Offering a language that filters nothing in the current space is noise.
        assert_eq!(view.available_languages, ["json"]);
    }

    #[test]
    fn available_languages_ignore_the_current_selection() {
        let mut connection = open_in_memory().unwrap();
        let space_id = space(&connection, "Perso");
        create(&mut connection, &written_in(&space_id, "json"), T0).unwrap();
        create(&mut connection, &written_in(&space_id, "yml"), T0).unwrap();

        let view = query(
            &connection,
            &NotesQuery {
                languages: vec!["json".to_string()],
                ..all_notes()
            },
        )
        .unwrap();

        // Narrowing the rail to the current results would leave a single facet
        // on screen and make a second selection impossible.
        assert_eq!(view.available_languages, ["json", "yml"]);
        assert_eq!(view.matched, 1);
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
