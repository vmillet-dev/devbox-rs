//! Module « Prise de notes ».
//!
//! Ces commandes sont de simples **adaptateurs** : elles verrouillent la
//! connexion partagée, délèguent à `storage::notes` et convertissent l'erreur en
//! `String` pour le pont Tauri. Toute la logique de persistance est dans
//! `storage/` — et donc testable sans lancer Tauri.
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
//!   (identifiant définitif, `updated_at` rafraîchi) : le store remplace sa
//!   copie locale par cette valeur de retour.
//! - `update_note` / `delete_note` sur un identifiant inconnu renvoient `Err`,
//!   jamais un `Ok` silencieux : le store s'en sert pour annuler sa mise à jour
//!   optimiste et remettre la note dans son état précédent.
//! - Dans un `NotePatch`, un champ **absent** signifie « ne pas toucher ». Le
//!   front n'envoie jamais `null` pour cela (voir `toNotePatchDto`), donc un
//!   `Option::None` n'écrase jamais la valeur stockée.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::storage::{self, Db};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// Espace de rangement. Le front filtre dessus : une note dont le `space_id`
    /// ne correspond à aucun espace renvoyé par `list_spaces` est invisible.
    /// Le stockage refuse d'ailleurs d'en créer une dans un espace inconnu.
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

/// Le mutex n'est empoisonné que si une commande a paniqué en le tenant : la
/// base peut alors être dans un état incohérent, autant le dire au lieu de
/// paniquer une seconde fois.
fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
    db.lock()
        .map_err(|_| "Stockage indisponible : une opération précédente a échoué".to_string())
}

/// Toutes les notes, tous espaces confondus — le filtrage par espace est fait
/// côté front, qui doit aussi pouvoir afficher « tous les espaces ».
#[tauri::command]
pub fn list_notes(db: State<'_, Db>) -> Result<Vec<Note>, String> {
    let connection = lock(&db)?;
    storage::notes::list(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_note(draft: NoteDraft, db: State<'_, Db>) -> Result<Note, String> {
    let mut connection = lock(&db)?;
    storage::notes::create(&mut connection, &draft, &storage::now_iso())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_note(id: String, patch: NotePatch, db: State<'_, Db>) -> Result<Note, String> {
    let mut connection = lock(&db)?;
    storage::notes::update(&mut connection, &id, &patch, &storage::now_iso())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_note(id: String, db: State<'_, Db>) -> Result<(), String> {
    let connection = lock(&db)?;
    storage::notes::delete(&connection, &id).map_err(|error| error.to_string())
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
