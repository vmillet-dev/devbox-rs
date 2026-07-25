//! Module « Prise de notes ».
//!
//! Ces commandes sont de simples **adaptateurs** : elles verrouillent la
//! connexion partagée, délèguent à `storage::notes` et convertissent l'erreur en
//! [`AppError`] pour le pont Tauri. Toute la logique est dans `storage/` — et
//! donc testable sans lancer Tauri.
//!
//! # Le back décide de ce qui est affiché
//!
//! `query_notes` ne renvoie pas une liste mais une **vue** ([`NotesView`]) :
//! notes filtrées, déjà réparties en sections, accompagnées des tags proposables
//! et du drapeau « une recherche est en cours ». Le front ne refiltre, ne
//! regroupe et ne trie rien — il affiche ce qu'il reçoit.
//!
//! # Contrat de sérialisation — à ne pas casser
//!
//! Deux pièges, sinon le front reçoit des données qu'il ne sait pas relire :
//!
//! - `#[serde(rename_all = "camelCase")]` sur `Note` : sans ça, serde émet
//!   `space_id` / `created_at` alors que le DTO TypeScript attend `spaceId` /
//!   `createdAt`.
//! - `#[serde(tag = "kind", rename_all = "camelCase")]` sur `NoteLifecycle` :
//!   la représentation serde par défaut d'une enum à données produit
//!   `{"Expires":{"at":"…"}}`, alors que le front discrimine sur un champ
//!   `kind` — il attend `{"kind":"expires","at":"…"}`.
//!
//! Les dates transitent en **chaîne ISO 8601 / RFC 3339 UTC** (JSON n'a pas de
//! type date) ; elles sont produites par `storage::now_iso`.
//!
//! Règles que le front tient pour acquises, et que `storage::notes` honore :
//! - `create_note` et `update_note` **renvoient la note telle que persistée**
//!   (identifiant définitif, `updated_at` rafraîchi) : c'est cette valeur que
//!   l'éditeur affiche, et elle fait autorité.
//! - `update_note` / `delete_note` sur un identifiant inconnu renvoient `Err`,
//!   jamais un `Ok` silencieux : sans ça le front croirait avoir enregistré.
//! - Dans un `NotePatch`, un champ **absent** signifie « ne pas toucher ». Le
//!   front n'envoie jamais `null` pour cela (voir `toNotePatchDto`), donc un
//!   `Option::None` n'écrase jamais la valeur stockée.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::error::AppError;
use crate::storage::{self, Db};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// Espace de rangement. C'est `query_notes` qui filtre dessus ; le stockage
    /// refuse de créer une note dans un espace inconnu.
    pub space_id: String,
    /// Peut être vide : une note fraîchement créée n'a pas encore de titre,
    /// l'interface affiche un libellé traduit à la place.
    pub title: String,
    /// "json" | "js" | "py" | "sql" | "yml" | "txt" — une valeur inconnue est
    /// dégradée en "txt" par le front, elle ne casse pas le chargement.
    pub language: String,
    pub content: String,
    /// Chemin de contexte libre, ex. "API Gateway / Auth". Peut être vide.
    pub source: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    /// ISO 8601, ex. "2026-07-25T09:12:00.000Z".
    pub created_at: String,
    pub updated_at: String,
    pub lifecycle: NoteLifecycle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteLifecycle {
    /// Note permanente.
    Permanent,
    /// Note éphémère : le front la classe « à trier » jusqu'à cette date.
    Expires { at: String },
}

/// Création : ni identifiant ni horodatages — c'est cette couche qui les attribue.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub space_id: String,
    pub title: String,
    pub language: String,
    pub content: String,
    pub source: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub lifecycle: NoteLifecycle,
}

/// Modification partielle : un champ à `None` reste **inchangé** en base.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    /// Renseigné uniquement lors d'un déplacement de note vers un autre espace.
    pub space_id: Option<String>,
    pub title: Option<String>,
    pub language: Option<String>,
    pub content: Option<String>,
    pub source: Option<String>,
    pub tags: Option<Vec<String>>,
    pub pinned: Option<bool>,
    pub lifecycle: Option<NoteLifecycle>,
}

/// Ce que l'utilisateur a demandé à voir. Tout y est explicite : la commande ne
/// lit ni horloge ni fuseau, ce qui la rend reproductible en test.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesQuery {
    /// `None` = « tous les espaces ». Ce n'est pas une absence de choix mais un
    /// choix : il n'existe aucun espace « Tous » côté données.
    pub space_id: Option<String>,
    /// Texte recherché dans le titre, les tags et le contenu. Vide = pas de recherche.
    pub search: String,
    pub filter: NoteFilter,
    /// Tags sélectionnés dans le rail. Une note passe si elle en porte **au
    /// moins un** (et non tous) : c'est le comportement d'un rail de facettes.
    pub tags: Vec<String>,
    /// Instant de référence, ISO 8601 UTC — fourni par `ClockService` côté front.
    pub now: String,
    /// `Date#getTimezoneOffset()` du front. Nécessaire parce que les sections
    /// raisonnent en **jours locaux** : à 23 h à Paris, `now` en UTC est déjà
    /// demain, et une note d'aujourd'hui tomberait dans « cette semaine ».
    ///
    /// ⚠️ Convention JavaScript : la valeur est l'opposé du décalage. UTC+2
    /// donne −120, d'où le `-` dans la conversion en `FixedOffset`.
    pub tz_offset_minutes: i32,
}

/// Filtre rapide de la barre d'outils. `Untriaged` = notes portant une date
/// d'expiration : une note éphémère est précisément celle dont on n'a pas encore
/// décidé du sort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteFilter {
    All,
    Pinned,
    Untriaged,
}

/// Ce que le canevas affiche, tel quel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesView {
    pub sections: Vec<NoteSection>,
    /// Tags proposés par le rail. Portée à l'**espace**, pas au filtre courant :
    /// n'afficher que les tags des notes déjà filtrées rendrait le rail
    /// inutilisable dès la première sélection.
    pub available_tags: Vec<String>,
    /// Une recherche ou une sélection de tags est active. Le front s'en sert
    /// pour distinguer « aucun résultat » d'« espace vide ».
    pub is_filtering: bool,
    /// Nombre de notes retenues, toutes sections confondues.
    pub matched: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSection {
    pub key: NoteSectionKey,
    pub notes: Vec<Note>,
    /// Au moins une note de la section expire : le front en dérive un indice visuel.
    pub has_expiring_notes: bool,
    /// Affiche la carte fantôme « coller ou créer » à la fin de la section.
    pub show_create_ghost: bool,
}

/// Sert de **clé de traduction** côté front (`sections.<key>`) : c'est pourquoi
/// aucun libellé lisible ne traverse le pont.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteSectionKey {
    Pinned,
    Today,
    Week,
    Older,
    Results,
}

fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, AppError> {
    db.lock().map_err(|_| AppError::storage_unavailable())
}

/// Notes filtrées **et** regroupées, prêtes à afficher. Il n'existe pas de
/// commande renvoyant la liste brute : elle inviterait à refiltrer côté front.
#[tauri::command]
pub fn query_notes(query: NotesQuery, db: State<'_, Db>) -> Result<NotesView, AppError> {
    let connection = lock(&db)?;
    Ok(storage::notes::query(&connection, &query)?)
}

#[tauri::command]
pub fn create_note(draft: NoteDraft, db: State<'_, Db>) -> Result<Note, AppError> {
    let mut connection = lock(&db)?;
    Ok(storage::notes::create(
        &mut connection,
        &draft,
        &storage::now_iso(),
    )?)
}

#[tauri::command]
pub fn update_note(id: String, patch: NotePatch, db: State<'_, Db>) -> Result<Note, AppError> {
    let mut connection = lock(&db)?;
    Ok(storage::notes::update(
        &mut connection,
        &id,
        &patch,
        &storage::now_iso(),
    )?)
}

#[tauri::command]
pub fn delete_note(id: String, db: State<'_, Db>) -> Result<(), AppError> {
    let connection = lock(&db)?;
    Ok(storage::notes::delete(&connection, &id)?)
}

/// Ces tests ne vérifient pas du code métier : ils figent la **forme JSON**
/// traversant le pont, la seule chose que le compilateur ne peut pas contrôler
/// et qui casse silencieusement le front (voir `src/app/core/data/note.dto.ts`).
#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Note {
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

    #[test]
    fn a_note_serialises_with_camel_case_keys() {
        let json = serde_json::to_value(sample()).unwrap();

        // The TypeScript DTO reads `spaceId` / `createdAt` / `updatedAt`; serde's
        // default would emit the snake_case field names and the front would see
        // `undefined` where it expects an ISO date.
        assert!(json.get("spaceId").is_some());
        assert!(json.get("createdAt").is_some());
        assert!(json.get("updatedAt").is_some());
        assert!(json.get("space_id").is_none());
        assert!(json.get("created_at").is_none());
    }

    #[test]
    fn a_permanent_lifecycle_serialises_as_a_tagged_object() {
        let json = serde_json::to_value(sample()).unwrap();

        // Not serde's default `"Permanent"` — the front discriminates on `kind`.
        assert_eq!(json["lifecycle"], serde_json::json!({ "kind": "permanent" }));
    }

    #[test]
    fn an_expiring_lifecycle_serialises_flat_with_its_date() {
        let note = Note {
            lifecycle: NoteLifecycle::Expires {
                at: "2026-08-01T00:00:00.000Z".to_string(),
            },
            ..sample()
        };

        let json = serde_json::to_value(note).unwrap();

        // Not `{"Expires":{"at":…}}`, which the TS discriminated union rejects.
        assert_eq!(
            json["lifecycle"],
            serde_json::json!({ "kind": "expires", "at": "2026-08-01T00:00:00.000Z" })
        );
    }

    #[test]
    fn a_patch_omitting_a_field_deserialises_to_none() {
        // `toNotePatchDto` copies field by field precisely so that untouched
        // fields are absent rather than null; absent must mean "leave alone".
        let patch: NotePatch = serde_json::from_value(serde_json::json!({
            "title": "Nouveau titre"
        }))
        .unwrap();

        assert_eq!(patch.title.as_deref(), Some("Nouveau titre"));
        assert!(patch.content.is_none());
        assert!(patch.tags.is_none());
        assert!(patch.lifecycle.is_none());
    }

    #[test]
    fn a_view_serialises_with_camel_case_keys() {
        let view = NotesView {
            sections: vec![NoteSection {
                key: NoteSectionKey::Week,
                notes: vec![sample()],
                has_expiring_notes: false,
                show_create_ghost: true,
            }],
            available_tags: vec!["auth".to_string()],
            is_filtering: false,
            matched: 1,
        };

        let json = serde_json::to_value(view).unwrap();

        assert!(json.get("availableTags").is_some());
        assert!(json.get("isFiltering").is_some());
        assert!(json.get("available_tags").is_none());
        assert!(json["sections"][0].get("hasExpiringNotes").is_some());
        assert!(json["sections"][0].get("showCreateGhost").is_some());
    }

    #[test]
    fn a_section_key_serialises_as_the_translation_key_the_front_expects() {
        let section = NoteSection {
            key: NoteSectionKey::Older,
            notes: Vec::new(),
            has_expiring_notes: false,
            show_create_ghost: false,
        };

        let json = serde_json::to_value(section).unwrap();

        // The front builds `sections.older` from this; serde's default would
        // emit "Older" and the lookup would miss.
        assert_eq!(json["key"], "older");
    }

    #[test]
    fn a_query_is_read_from_the_camel_case_payload_the_front_sends() {
        let query: NotesQuery = serde_json::from_value(serde_json::json!({
            "spaceId": "s-1",
            "search": "deploy",
            "filter": "untriaged",
            "tags": ["urgent"],
            "now": "2026-07-25T09:00:00.000Z",
            "tzOffsetMinutes": -120
        }))
        .unwrap();

        assert_eq!(query.space_id.as_deref(), Some("s-1"));
        assert_eq!(query.filter, NoteFilter::Untriaged);
        assert_eq!(query.tz_offset_minutes, -120);
    }

    #[test]
    fn a_null_space_is_read_as_every_space() {
        // The front sends null, not an omitted key, when the user picks
        // "all spaces" — that is a choice, not a missing value.
        let query: NotesQuery = serde_json::from_value(serde_json::json!({
            "spaceId": null,
            "search": "",
            "filter": "all",
            "tags": [],
            "now": "2026-07-25T09:00:00.000Z",
            "tzOffsetMinutes": 0
        }))
        .unwrap();

        assert!(query.space_id.is_none());
    }

    #[test]
    fn a_draft_is_read_from_the_camel_case_payload_the_front_sends() {
        let draft: NoteDraft = serde_json::from_value(serde_json::json!({
            "spaceId": "s-1",
            "title": "",
            "language": "sql",
            "content": "SELECT 1",
            "source": "",
            "tags": ["db"],
            "pinned": true,
            "lifecycle": { "kind": "expires", "at": "2026-08-01T00:00:00.000Z" }
        }))
        .unwrap();

        assert_eq!(draft.space_id, "s-1");
        assert!(draft.pinned);
        assert!(matches!(draft.lifecycle, NoteLifecycle::Expires { .. }));
    }
}
