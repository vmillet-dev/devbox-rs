//! Modèle et règles métier de DevBox.
//!
//! # Ce que cette couche ne connaît pas
//!
//! Ni la base de données, ni Tauri. Elle ne dépend que de `serde` et `chrono`,
//! et c'est ce qui permet d'éprouver une règle — regroupement en sections,
//! normalisation des tags, correspondance d'une recherche — sans ouvrir de
//! connexion ni lancer l'application.
//!
//! # Sens des dépendances
//!
//! ```text
//! commands/  ──►  domain/  ◄──  storage/
//! ```
//!
//! La persistance sait lire et écrire ce modèle, le transport sait le
//! sérialiser, aucun des deux ne le définit. L'inverse — le modèle rangé dans
//! `commands/` — faisait dépendre la persistance du transport.
//!
//! # Pourquoi serde vit ici
//!
//! Les attributs de sérialisation sont portés par le modèle plutôt que par une
//! seconde famille de DTO : à cette échelle, le mapping coûterait plus qu'il ne
//! protège. Le contrat traversant le pont est figé par les tests de [`note`],
//! [`query`] et [`space`] — la seule chose que le compilateur ne peut pas
//! vérifier et qui casse silencieusement le front.

pub mod display;
pub mod language;
pub mod note;
pub mod query;
pub mod search;
pub mod sections;
pub mod space;
pub mod tags;
pub mod validation;
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
