//! Ce qui sort de DevBox et ce qui y rentre : le format d'échange et le rendu
//! Markdown du partage.
//!
//! Le format reprend les types du domaine plutôt que d'en dupliquer une copie —
//! un champ ajouté à `Note` se retrouve exporté sans qu'on y pense, et un ancien
//! fichier reste lisible tant que serde sait combler l'absence.

use std::collections::BTreeMap;
use std::fmt::Write;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{StorageError, ValidationError};
use crate::notes::checklist::{self, NoteKind};
use crate::notes::model::Note;
use crate::spaces::model::Space;

/// Incrémentée quand un fichier écrit aujourd'hui cesserait d'être lisible.
/// Refuser une version plus récente vaut mieux qu'en importer la moitié.
pub const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub spaces: Vec<Space>,
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub notes: u32,
    pub spaces: u32,
}

/// `skipped` : notes déjà présentes (même identifiant) ou dont l'espace manque
/// au fichier. Un import doit pouvoir être rejoué sans dupliquer.
#[derive(Debug, Clone, Copy, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub spaces_created: u32,
    pub notes_imported: u32,
    pub notes_skipped: u32,
}

pub fn read_bundle(json: &str) -> Result<Bundle, StorageError> {
    let bundle: Bundle = serde_json::from_str(json)
        .map_err(|error| StorageError::ImportFormat(error.to_string()))?;

    if bundle.version > FORMAT_VERSION {
        return Err(StorageError::ImportFormat(format!(
            "format version {}, this version of DevBox reads up to {FORMAT_VERSION}",
            bundle.version
        )));
    }

    Ok(bundle)
}

/// Le chemin est choisi par l'utilisateur dans un sélecteur de fichiers ; on
/// vérifie seulement qu'il en est un.
pub fn validate_path(path: &str) -> Result<(), ValidationError> {
    if path.trim().is_empty() {
        return Err(ValidationError::new("path", "no file chosen"));
    }

    Ok(())
}

/// Une clôture plus longue que la plus longue suite de backticks du contenu :
/// sans ça, une note qui contient déjà un bloc Markdown coupe le sien en deux.
fn fence_for(content: &str) -> String {
    let longest = content.split(|c| c != '`').map(str::len).max().unwrap_or(0);

    "`".repeat(longest.max(2) + 1)
}

/// Rendu destiné à être collé ailleurs (revue, ticket, message) : titres,
/// contexte, tags, puis le contenu dans un bloc annoté par son langage.
///
/// Une todolist sort en liste de tâches Markdown plutôt qu'en bloc clôturé :
/// elle n'a pas de contenu, et un bloc vide ne se colle nulle part.
pub fn to_markdown(notes: &[Note], space_names: &BTreeMap<String, String>) -> String {
    let mut out = String::new();

    for note in notes {
        if !out.is_empty() {
            out.push('\n');
        }

        let title = if note.title.trim().is_empty() {
            "—"
        } else {
            note.title.trim()
        };
        let _ = writeln!(out, "## {title}\n");

        let mut meta: Vec<String> = Vec::new();
        if let Some(space) = space_names.get(&note.space_id) {
            meta.push(space.clone());
        }
        if !note.source.trim().is_empty() {
            meta.push(note.source.trim().to_string());
        }
        if !note.tags.is_empty() {
            meta.push(
                note.tags
                    .iter()
                    .map(|tag| format!("#{tag}"))
                    .collect::<Vec<_>>()
                    .join(" "),
            );
        }
        if !meta.is_empty() {
            let _ = writeln!(out, "_{}_\n", meta.join(" · "));
        }

        if note.kind == NoteKind::Checklist {
            let _ = writeln!(out, "{}", checklist::to_markdown(&note.items));
            continue;
        }

        let fence = fence_for(&note.content);
        let _ = writeln!(
            out,
            "{fence}{}\n{}\n{fence}",
            note.language,
            note.content.trim_end()
        );
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::checklist::ChecklistItem;
    use crate::notes::fixtures::note as sample;

    fn spaces() -> BTreeMap<String, String> {
        BTreeMap::from([("s-1".to_string(), "Perso".to_string())])
    }

    #[test]
    fn a_shared_note_carries_its_space_context_and_tags() {
        let mut note = sample();
        note.source = "API Gateway / Auth".to_string();

        let markdown = to_markdown(&[note], &spaces());

        assert!(markdown.contains("## Title"));
        assert!(markdown.contains("_Perso · API Gateway / Auth · #auth_"));
        assert!(markdown.contains("```txt\nContent\n```"));
    }

    #[test]
    fn a_note_already_containing_a_fence_is_not_cut_in_half() {
        let mut note = sample();
        note.content = "```sh\necho hi\n```".to_string();

        let markdown = to_markdown(&[note], &spaces());

        // La clôture extérieure doit être plus longue que celle du contenu.
        assert!(markdown.contains("````txt"));
        assert!(markdown.ends_with("````\n"));
    }

    #[test]
    fn a_todo_list_is_shared_as_a_markdown_task_list() {
        // Elle n'a pas de contenu : un bloc clôturé vide ne se colle nulle part.
        let mut note = sample();
        note.kind = NoteKind::Checklist;
        note.content = String::new();
        note.items = vec![
            ChecklistItem {
                text: "Relire".to_string(),
                done: true,
            },
            ChecklistItem {
                text: "Déployer".to_string(),
                done: false,
            },
        ];

        let markdown = to_markdown(&[note], &spaces());

        assert!(markdown.contains("- [x] Relire"));
        assert!(markdown.contains("- [ ] Déployer"));
        assert!(!markdown.contains("```"));
    }

    #[test]
    fn an_untitled_note_still_gets_a_heading() {
        let mut note = sample();
        note.title = "   ".to_string();

        assert!(to_markdown(&[note], &spaces()).starts_with("## —"));
    }

    #[test]
    fn a_bundle_from_a_newer_version_is_refused_rather_than_half_read() {
        let json = serde_json::json!({
            "version": FORMAT_VERSION + 1,
            "exportedAt": "2026-07-25T09:00:00.000Z",
            "spaces": [],
            "notes": [],
        })
        .to_string();

        let error = read_bundle(&json).unwrap_err();

        assert!(matches!(error, StorageError::ImportFormat(_)));
    }

    #[test]
    fn a_file_that_is_not_a_bundle_is_reported_as_such() {
        assert!(matches!(
            read_bundle("{\"hello\":true}").unwrap_err(),
            StorageError::ImportFormat(_)
        ));
    }

    #[test]
    fn a_bundle_round_trips_through_its_own_format() {
        let bundle = Bundle {
            version: FORMAT_VERSION,
            exported_at: sample().created_at,
            spaces: vec![Space {
                id: "s-1".to_string(),
                name: "Perso".to_string(),
            }],
            notes: vec![sample()],
        };

        let read = read_bundle(&serde_json::to_string(&bundle).unwrap()).unwrap();

        assert_eq!(read.notes.len(), 1);
        assert_eq!(read.notes[0].title, "Title");
        assert_eq!(read.spaces[0].name, "Perso");
    }
}
