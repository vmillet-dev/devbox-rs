//! Lecture et écriture des notes : **du SQL, et rien d'autre**.
//!
//! Ne descend dans le `WHERE` que ce que SQLite indexe. Recherche texte,
//! sections et normalisation des tags sont des règles : `crate::domain`.

use std::collections::HashMap;

use diesel::prelude::*;
use uuid::Uuid;

use chrono::{DateTime, Utc};

use super::schema::{note_tags, notes};
use super::{StorageError, spaces};
use crate::domain::iso8601;
use crate::domain::note::{Note, NoteDraft, NoteLifecycle, NotePatch};
use crate::domain::tag;
use crate::domain::view::{Facets, NoteFilter, NotesQuery};

/// `lifecycle` y est éclaté en deux colonnes, et les tags en sont absents : ils
/// vivent dans `note_tags`, rattachés ensuite en une requête pour toute la liste.
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
}

/// Une date illisible fait **échouer la lecture** : ces colonnes ne sont écrites
/// que par [`iso8601::format`], donc une valeur hors format signale une base
/// corrompue, et deviner y rangerait la note à une date arbitraire sans rien dire.
///
/// Le langage, lui, se replie sur son défaut : `notes.language` ne porte aucun
/// `CHECK` (migration 3), une version plus récente peut y avoir écrit un langage
/// légitime qu'ignore celle-ci. La note reste lisible, sans sa coloration.
impl TryFrom<NoteRow> for Note {
    type Error = StorageError;

    fn try_from(row: NoteRow) -> Result<Self, Self::Error> {
        let instant = |field: &'static str, value: &str| {
            iso8601::parse(value).map_err(|_| StorageError::CorruptRow {
                id: row.id.clone(),
                field,
            })
        };

        // Le `CHECK` du schéma rend `("expires", None)` inatteignable.
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
            id: row.id,
            space_id: row.space_id,
            title: row.title,
            content: row.content,
            source: row.source,
            tags: Vec::new(),
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
        }
    }
}

/// Une requête pour toute la liste : une par note coûterait cher dès quelques
/// centaines.
fn all_tags(
    connection: &mut SqliteConnection,
) -> Result<HashMap<String, Vec<String>>, StorageError> {
    let rows = note_tags::table
        .select((note_tags::note_id, note_tags::tag))
        .order(note_tags::tag.asc())
        .load::<(String, String)>(connection)?;

    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();
    for (note_id, tag) in rows {
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

/// Écrit les tags **déjà normalisés** par le domaine, et renvoie ce que la
/// relecture donne.
///
/// ⚠️ Relus plutôt que triés ici : `note_tags.tag` est `COLLATE NOCASE` et la
/// lecture ordonne dans cette collation, qu'un `sort()` en octets ne reproduit
/// pas — `Urgent` passerait avant `auth` à l'écriture et après au rechargement.
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

/// Portées à l'espace et non au filtre courant — voir [`NotesView`].
///
/// La jointure sur `notes` est inconditionnelle : toute ligne de `note_tags`
/// pointe une note existante, elle n'ajoute ni ne retire donc rien quand aucun
/// espace n'est actif.
fn facets(
    connection: &mut SqliteConnection,
    space_id: Option<&str>,
) -> Result<Facets, StorageError> {
    let mut tags = note_tags::table
        .inner_join(notes::table)
        .select(note_tags::tag)
        .distinct()
        .order(note_tags::tag.asc())
        .into_boxed();
    let mut languages = notes::table
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
        // Un langage stocké qu'on ne connaît pas n'a pas de facette à proposer :
        // le rail ne peut pas offrir un filtre que le front ne sait pas nommer.
        languages: languages
            .load::<String>(connection)?
            .iter()
            .filter_map(|language| language.parse().ok())
            .collect(),
    })
}

/// Critères **grossiers** seulement ; `domain::view::build` prend le relais pour
/// la recherche texte et les sections.
pub fn fetch(
    connection: &mut SqliteConnection,
    request: &NotesQuery,
) -> Result<(Vec<Note>, Facets), StorageError> {
    let mut query = notes::table.select(NoteRow::as_select()).into_boxed();

    if let Some(space_id) = &request.space_id {
        query = query.filter(notes::space_id.eq(space_id.clone()));
    }

    match request.filter {
        NoteFilter::All => {}
        NoteFilter::Pinned => query = query.filter(notes::pinned.eq(true)),
        NoteFilter::Untriaged => query = query.filter(notes::lifecycle_kind.eq("expires")),
    }

    if !request.languages.is_empty() {
        // Union, comme les tags : sélectionner JSON puis YAML montre les deux.
        let selected: Vec<String> = request.languages.iter().map(ToString::to_string).collect();
        query = query.filter(notes::language.eq_any(selected));
    }

    // Même normalisation qu'à l'écriture, sinon un `#urgent` saisi au clavier ne
    // retrouverait pas le `urgent` stocké.
    let selected_tags = tag::normalize(&request.tags);
    if !selected_tags.is_empty() {
        // « au moins un tag », pas « tous » : comportement d'un rail de facettes.
        query = query.filter(
            notes::id.eq_any(
                note_tags::table
                    .select(note_tags::note_id)
                    .filter(note_tags::tag.eq_any(selected_tags)),
            ),
        );
    }

    // Sur `updated_at` alors que les sections regroupent sur `created_at` : la
    // section dit quand la note est née, l'ordre interne laquelle a bougé en
    // dernier. Le front conserve l'ordre reçu.
    let mut notes = query
        .order((notes::updated_at.desc(), notes::id.asc()))
        .load::<NoteRow>(connection)?
        .into_iter()
        .map(Note::try_from)
        .collect::<Result<Vec<_>, _>>()?;

    // La recherche du domaine porte dessus.
    let mut grouped = all_tags(connection)?;
    for note in &mut notes {
        note.tags = grouped.remove(&note.id).unwrap_or_default();
    }

    Ok((notes, facets(connection, request.space_id.as_deref())?))
}

fn find(connection: &mut SqliteConnection, id: &str) -> Result<Option<Note>, StorageError> {
    let Some(row) = notes::table
        .find(id)
        .select(NoteRow::as_select())
        .first::<NoteRow>(connection)
        .optional()?
    else {
        return Ok(None);
    };

    Ok(Some(Note {
        tags: tags_of(connection, id)?,
        ..Note::try_from(row)?
    }))
}

/// Renvoie la version persistée — identifiant et horodatages compris. Le front
/// adopte cette valeur telle quelle.
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

        Ok(note)
    })
}

/// Lit, applique le patch, réécrit — en transaction pour qu'aucune commande ne
/// s'intercale. La fusion est une règle et vit dans [`NotePatch::apply`].
///
/// Identifiant inconnu ⇒ `Err` : le front croirait sinon avoir enregistré.
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

        // Seule vérification que le domaine ne peut pas faire : elle demande la base.
        if let Some(space_id) = &patch.space_id
            && !spaces::exists(connection, space_id)?
        {
            return Err(StorageError::SpaceNotFound(space_id.clone()));
        }

        patch.apply(&mut note, now);

        // Colonnes énumérées plutôt qu'un `AsChangeset` : celui-ci réécrirait
        // aussi `created_at`, que rien ici n'a le droit de bouger.
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
            ))
            .execute(connection)?;

        if patch.tags.is_some() {
            let written = std::mem::take(&mut note.tags);
            note.tags = replace_tags(connection, &note.id, &written)?;
        }

        Ok(note)
    })
}

/// Ses tags partent par cascade — d'où le `PRAGMA foreign_keys` de
/// `storage::configure`. Identifiant inconnu ⇒ `Err`.
pub fn delete(connection: &mut SqliteConnection, id: &str) -> Result<(), StorageError> {
    let deleted = diesel::delete(notes::table.find(id)).execute(connection)?;

    if deleted == 0 {
        return Err(StorageError::NoteNotFound(id.to_string()));
    }

    Ok(())
}
