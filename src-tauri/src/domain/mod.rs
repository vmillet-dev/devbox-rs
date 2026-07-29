//! Modèle et règles métier : `commands/ ──► domain/ ◄── storage/`.
//!
//! Ne connaît ni SQLite ni Tauri — d'où des règles éprouvables sans ouvrir de
//! connexion ni lancer l'application.
//!
//! Les attributs serde sont portés par le modèle plutôt que par une seconde
//! famille de DTO. Le contrat traversant le pont est figé par des tests de
//! sérialisation : c'est ce que le compilateur ne peut pas vérifier et qui
//! casse silencieusement le front.

pub mod note;
pub mod rules;
pub mod sections;
pub mod space;
pub mod view;

/// Reference note shared by the domain tests, so a field added to `Note` is
/// declared once instead of in every test module that builds one.
#[cfg(test)]
pub(crate) mod fixtures {
    use super::note::{Note, NoteLifecycle};

    pub(crate) fn note() -> Note {
        Note {
            id: "n-1".to_string(),
            space_id: "s-1".to_string(),
            title: "Titre".to_string(),
            language: "txt".to_string(),
            content: "Contenu".to_string(),
            source: String::new(),
            tags: vec!["auth".to_string()],
            pinned: false,
            created_at: "2026-07-25T09:00:00.000Z".to_string(),
            updated_at: "2026-07-25T09:00:00.000Z".to_string(),
            lifecycle: NoteLifecycle::Permanent,
        }
    }
}
