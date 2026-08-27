//! Import, export et partage : faire sortir les notes de la machine, et les y
//! faire rentrer.
//!
//! Le fichier est écrit et lu **ici**, pas côté front : la sérialisation est
//! celle du domaine, et la faire traverser le pont pour être réassemblée en
//! TypeScript ajouterait un second format à tenir.
//!
//! Les commandes ne font que choisir *quoi* transférer et toucher le disque ;
//! l'assemblage ([`collect`]) et la fusion ([`merge`]) sont des fonctions sur une
//! connexion, donc testables contre une base en mémoire sans lancer Tauri.

// Une commande reçoit ses arguments désérialisés depuis la charge utile IPC :
// ils arrivent possédés, qu'elle les consomme ou non.
#![allow(clippy::needless_pass_by_value)]

pub mod model;

use std::collections::BTreeMap;

use chrono::Utc;
use diesel::SqliteConnection;
use tauri::State;

use crate::db::{Db, lock};
use crate::error::{AppError, StorageError};
use crate::notes::model::Note;
use crate::notes::store as notes;
use crate::spaces::model::Space;
use crate::spaces::store as spaces;
use model::{Bundle, ExportReport, ImportReport};

fn space_names(
    connection: &mut SqliteConnection,
) -> Result<BTreeMap<String, String>, StorageError> {
    Ok(spaces::list(connection)?
        .into_iter()
        .map(|space| (space.id, space.name))
        .collect())
}

/// Assemble le fichier autour des notes fournies.
///
/// Seuls les espaces **réellement cités** partent avec : exporter un espace ne
/// doit pas recréer toute l'arborescence chez qui importe.
pub fn collect(
    connection: &mut SqliteConnection,
    exported: Vec<Note>,
) -> Result<Bundle, StorageError> {
    let spaces: Vec<Space> = spaces::list(connection)?
        .into_iter()
        .filter(|space| exported.iter().any(|note| note.space_id == space.id))
        .collect();

    Ok(Bundle {
        version: model::FORMAT_VERSION,
        exported_at: Utc::now(),
        spaces,
        notes: exported,
    })
}

/// Fait entrer un fichier dans la base : **fusion, jamais remplacement**.
///
/// Les espaces sont rapprochés par leur nom (insensible à la casse), et une note
/// dont l'identifiant est déjà pris est comptée puis laissée de côté. Réimporter
/// le même fichier deux fois ne duplique donc rien — et réimporter un fichier
/// exporté depuis *cette* base n'ajoute rien du tout, ce que le compte rendu dit.
pub fn merge(
    connection: &mut SqliteConnection,
    bundle: Bundle,
) -> Result<ImportReport, StorageError> {
    let mut report = ImportReport::default();

    // Identifiant d'espace du fichier → identifiant local.
    let mut mapping: BTreeMap<String, String> = BTreeMap::new();
    let existing = spaces::list(connection)?;

    for space in &bundle.spaces {
        let matched = existing
            .iter()
            .find(|candidate| candidate.name.to_lowercase() == space.name.to_lowercase());

        let local_id = if let Some(candidate) = matched {
            candidate.id.clone()
        } else {
            report.spaces_created += 1;
            spaces::create(connection, &space.name)?.id
        };
        mapping.insert(space.id.clone(), local_id);
    }

    for mut note in bundle.notes {
        let Some(space_id) = mapping.get(&note.space_id) else {
            // Un fichier tronqué à la main : la note n'a pas d'espace où aller,
            // et en inventer un la rangerait là où personne ne la cherchera.
            report.notes_skipped += 1;
            continue;
        };
        note.space_id.clone_from(space_id);

        if notes::insert_imported(connection, &note)? {
            report.notes_imported += 1;
        } else {
            report.notes_skipped += 1;
        }
    }

    Ok(report)
}

fn write(path: &str, bundle: &Bundle) -> Result<ExportReport, AppError> {
    let report = ExportReport {
        notes: u32::try_from(bundle.notes.len()).unwrap_or(u32::MAX),
        spaces: u32::try_from(bundle.spaces.len()).unwrap_or(u32::MAX),
    };

    let json = serde_json::to_string_pretty(bundle)
        .map_err(|error| StorageError::File(error.to_string()))?;
    std::fs::write(path, json).map_err(|error| StorageError::File(format!("{path}: {error}")))?;

    Ok(report)
}

/// Tout le corpus, ou le seul espace actif. Les espaces voyagent avec les notes :
/// sans eux, l'import n'aurait qu'un identifiant à ranger nulle part.
#[tauri::command]
#[specta::specta]
pub fn export_notes(
    path: String,
    space_id: Option<String>,
    db: State<'_, Db>,
) -> Result<ExportReport, AppError> {
    model::validate_path(&path)?;

    let bundle = {
        let mut connection = lock(&db)?;
        let exported = notes::all(&mut connection, space_id.as_deref())?;
        collect(&mut connection, exported)?
    };

    write(&path, &bundle)
}

/// Même fichier, mêmes règles, mais restreint aux notes désignées : c'est ce
/// qu'on envoie à quelqu'un plutôt que toute sa bibliothèque.
#[tauri::command]
#[specta::specta]
pub fn export_selection(
    path: String,
    ids: Vec<String>,
    db: State<'_, Db>,
) -> Result<ExportReport, AppError> {
    model::validate_path(&path)?;

    let bundle = {
        let mut connection = lock(&db)?;
        let exported = notes::by_ids(&mut connection, &ids)?;
        collect(&mut connection, exported)?
    };

    write(&path, &bundle)
}

#[tauri::command]
#[specta::specta]
pub fn import_notes(path: String, db: State<'_, Db>) -> Result<ImportReport, AppError> {
    model::validate_path(&path)?;

    let json = std::fs::read_to_string(&path)
        .map_err(|error| StorageError::File(format!("{path}: {error}")))?;
    let bundle = model::read_bundle(&json)?;

    let mut connection = lock(&db)?;

    Ok(merge(&mut connection, bundle)?)
}

/// Rendu Markdown d'une sélection, que le front pose dans le presse-papier.
/// Rien n'est envoyé nulle part : « partager » s'arrête au presse-papier.
#[tauri::command]
#[specta::specta]
pub fn share_notes(ids: Vec<String>, db: State<'_, Db>) -> Result<String, AppError> {
    let mut connection = lock(&db)?;
    let selected = notes::by_ids(&mut connection, &ids)?;
    let names = space_names(&mut connection)?;

    Ok(model::to_markdown(&selected, &names))
}
