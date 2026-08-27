//! Reading and writing notes: **SQL, and nothing else**.
//!
//! Only what SQLite indexes goes down into the `WHERE` clause. Text search,
//! sections and tag normalization are rules: `super::view` and
//! `super::model`.

use std::collections::HashMap;

use diesel::prelude::*;
use uuid::Uuid;

use chrono::{DateTime, Utc};

use super::model::{self, Note, NoteDraft, NoteLifecycle, NotePatch};
use super::trash;
use super::view::{Facets, NoteFilter, NotesQuery};
use crate::db::iso8601;
use crate::db::schema::{note_tags, notes};
use crate::error::StorageError;
use crate::spaces::store as spaces;

/// `lifecycle` is split into two columns here, and tags are absent: they
/// live in `note_tags`, then attached in a single query for the whole list.
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

/// An unreadable date makes the **read fail**: these columns are only written
/// by [`iso8601::format`], so an out-of-format value signals a corrupted
/// database, and guessing would place the note at an arbitrary date without saying anything.
///
/// The language, however, falls back to its default: `notes.language` carries no
/// `CHECK` (migration 3), a newer version may have written a legitimate language
/// that this one ignores. The note remains readable, without its highlighting.
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

/// One query for the whole list: one per note would be expensive from a few
/// hundred onwards.
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
        // Un langage stocké qu'on ne connaît pas n'a pas de facette à proposer :
        // le rail ne peut pas offrir un filtre que le front ne sait pas nommer.
        languages: languages
            .load::<String>(connection)?
            .iter()
            .filter_map(|language| language.parse().ok())
            .collect(),
    })
}

/// Critères **grossiers** seulement ; `view::build` prend le relais pour
/// la recherche texte et les sections.
pub fn fetch(
    connection: &mut SqliteConnection,
    request: &NotesQuery,
) -> Result<(Vec<Note>, Facets), StorageError> {
    // La corbeille n'est visible que par `list_trashed` : une note supprimée qui
    // ressortirait ici serait éditable sans jamais dire qu'elle est en sursis.
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
        // Union, comme les tags : sélectionner JSON puis YAML montre les deux.
        let selected: Vec<String> = request.languages.iter().map(ToString::to_string).collect();
        query = query.filter(notes::language.eq_any(selected));
    }

    // Même normalisation qu'à l'écriture, sinon un `#urgent` saisi au clavier ne
    // retrouverait pas le `urgent` stocké.
    let selected_tags = model::normalize_tags(&request.tags);
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
        .filter(notes::deleted_at.is_null())
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

/// **Ne supprime pas** : date la note, qui rejoint la corbeille. La suppression
/// définitive est [`purge`], et la rétention est une règle de `super::trash`.
///
/// Identifiant inconnu — ou déjà en corbeille — ⇒ `Err` : le front croirait
/// sinon avoir supprimé.
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

/// Renvoie le nombre de notes effectivement déplacées : une sélection peut
/// contenir un identifiant devenu obsolète, et refuser tout le lot pour un seul
/// disparu serait pire que le résultat partiel.
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

/// Sortie de corbeille. `updated_at` n'est pas touché : la note revient là où
/// elle était, pas en tête du canevas.
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

/// Les notes en corbeille, la plus récemment supprimée en tête.
pub fn list_trashed(
    connection: &mut SqliteConnection,
) -> Result<Vec<(Note, DateTime<Utc>)>, StorageError> {
    let rows = notes::table
        .filter(notes::deleted_at.is_not_null())
        .select((NoteRow::as_select(), notes::deleted_at))
        .order((notes::deleted_at.desc(), notes::id.asc()))
        .load::<(NoteRow, Option<String>)>(connection)?;

    let mut grouped = all_tags(connection)?;
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

/// Identifiants des notes dont la rétention est écoulée. Séparé de [`purge`]
/// pour que l'appelant récupère d'abord les fichiers joints à effacer.
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

/// Suppression **définitive**. Tags et pièces jointes partent par cascade —
/// d'où le `PRAGMA foreign_keys` de `db::configure` ; les fichiers sur le disque,
/// eux, sont l'affaire de l'appelant.
///
/// Restreinte aux notes en corbeille : rien ne doit pouvoir court-circuiter le
/// sursis de 30 jours.
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

/// Déplacement en masse. L'espace de destination est vérifié une fois pour tout
/// le lot.
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

/// Ajoute des tags **déjà normalisés** sans toucher à ceux déjà posés : une
/// action de masse enrichit, elle ne remplace pas.
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

        // `insert_or_ignore` : la clé primaire `(note_id, tag)` est `NOCASE`,
        // donc reposer un tag déjà présent ne fait rien plutôt que d'échouer.
        diesel::insert_or_ignore_into(note_tags::table)
            .values(rows)
            .execute(connection)?;

        diesel::update(notes::table.filter(notes::id.eq_any(&targets)))
            .set(notes::updated_at.eq(iso8601::format(now)))
            .execute(connection)?;

        Ok(targets.len())
    })
}

/// Chaque tag du corpus et le nombre de notes vivantes qui le portent.
pub fn tag_usage(connection: &mut SqliteConnection) -> Result<Vec<(String, i64)>, StorageError> {
    Ok(note_tags::table
        .inner_join(notes::table)
        .filter(notes::deleted_at.is_null())
        .group_by(note_tags::tag)
        .select((note_tags::tag, diesel::dsl::count_star()))
        .order(note_tags::tag.asc())
        .load::<(String, i64)>(connection)?)
}

/// Renomme ou fusionne : `sources` deviennent `target` partout.
///
/// ⚠️ `updated_at` reste intact. Un renommage global toucherait sinon tout le
/// corpus, et le canevas — qui trie dessus — remonterait des notes que personne
/// n'a rouvertes.
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

        // La cible est balayée avec les sources, puis réécrite : c'est ce qui
        // rend une simple correction de casse effective. `INSERT OR IGNORE`
        // seul ne changerait rien — la clé primaire est `NOCASE`, donc « Auth »
        // et « auth » y sont la même ligne.
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

/// Retire un tag du corpus. Les notes restent, seul l'étiquetage disparaît.
pub fn drop_tag(connection: &mut SqliteConnection, tag: &str) -> Result<usize, StorageError> {
    Ok(diesel::delete(note_tags::table.filter(note_tags::tag.eq(tag))).execute(connection)?)
}

/// Toutes les notes vivantes d'un espace — ou du corpus. Réservé à l'export :
/// aucune commande ne rend cette liste au front, qui serait tenté de refiltrer.
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

    let mut grouped = all_tags(connection)?;
    for note in &mut notes {
        note.tags = grouped.remove(&note.id).unwrap_or_default();
    }

    Ok(notes)
}

/// Notes désignées par leur identifiant, dans l'ordre de la base. Sert au
/// partage d'une sélection.
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

    let mut grouped = all_tags(connection)?;
    for note in &mut notes {
        note.tags = grouped.remove(&note.id).unwrap_or_default();
    }

    Ok(notes)
}

/// Écrit une note venue d'un import, **avec son identifiant et ses dates**.
/// Un identifiant déjà présent n'est pas écrasé : le retour dit s'il y a eu
/// écriture, et l'import compte les ignorées.
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

        Ok(true)
    })
}
