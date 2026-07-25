//! Module "Prise de notes" (à implémenter).
//!
//! Le front-end est **prêt et attend ces commandes** : voir
//! `src/app/core/data/tauri-notes-repository.ts`, qui les appelle déjà, et
//! `src/app/core/data/note.dto.ts`, qui définit le contrat de sérialisation.
//! Basculer le front sur ce module ne demandera qu'un changement de provider
//! dans `src/app/core/data/data.providers.ts`.
//!
//! Astuce : gardez la logique métier (lecture/écriture disque, base SQLite, etc.)
//! dans des fonctions Rust "pures" séparées de Tauri, et faites de vos
//! `#[tauri::command]` de simples adaptateurs qui les appellent.
//! Cela facilite grandement les tests unitaires.
//!
//! # TODO — contrat attendu par le front-end
//!
//! ## 1. Structures sérialisées
//!
//! Deux pièges de sérialisation, sinon le front reçoit des données qu'il ne
//! sait pas relire :
//!
//! - `#[serde(rename_all = "camelCase")]` sur `Note` : sans ça, serde émet
//!   `created_at` / `updated_at` alors que le DTO TypeScript attend
//!   `createdAt` / `updatedAt`.
//! - `#[serde(tag = "kind", rename_all = "camelCase")]` sur `NoteLifecycle` :
//!   la représentation serde par défaut d'une enum à données produit
//!   `{"Expires":{"at":"…"}}`, alors que le front discrimine sur un champ
//!   `kind` — il attend `{"kind":"expires","at":"…"}`.
//!
//! Les dates transitent en **chaîne ISO 8601 / RFC 3339 UTC** (JSON n'a pas de
//! type date). `chrono::DateTime<Utc>` sérialise déjà dans ce format.
//!
//! ```ignore
//! #[derive(serde::Serialize, serde::Deserialize)]
//! #[serde(rename_all = "camelCase")]
//! pub struct Note {
//!     pub id: String,
//!     pub title: String,       // peut être vide : une note fraîchement créée n'a pas de titre
//!     pub language: String,    // "json" | "js" | "py" | "sql" | "yml" | "txt"
//!     pub content: String,
//!     pub source: String,
//!     pub tags: Vec<String>,
//!     pub pinned: bool,
//!     pub created_at: String,  // ISO 8601, ex. "2026-07-25T09:12:00Z"
//!     pub updated_at: String,
//!     pub lifecycle: NoteLifecycle,
//! }
//!
//! #[derive(serde::Serialize, serde::Deserialize)]
//! #[serde(tag = "kind", rename_all = "camelCase")]
//! pub enum NoteLifecycle {
//!     Permanent,
//!     Expires { at: String },
//! }
//!
//! /// Création : ni `id` ni horodatages — c'est le backend qui les attribue.
//! #[derive(serde::Deserialize)]
//! #[serde(rename_all = "camelCase")]
//! pub struct NoteDraft { /* tous les champs de Note sauf id/created_at/updated_at */ }
//!
//! /// Modification partielle : tout est optionnel, un champ absent doit rester inchangé.
//! /// Le front omet les champs non modifiés (il n'envoie jamais `null` pour "ne pas toucher").
//! #[derive(serde::Deserialize)]
//! #[serde(rename_all = "camelCase")]
//! pub struct NotePatch { /* Option<T> pour chaque champ de NoteDraft */ }
//! ```
//!
//! ## 2. Commandes à écrire
//!
//! Les noms d'arguments doivent correspondre **exactement** à ceux du front
//! (Tauri apparie par nom, pas par position) :
//!
//! | Commande      | Signature attendue                                  | Appelée par |
//! |---------------|-----------------------------------------------------|-------------|
//! | `list_notes`  | `() -> Result<Vec<Note>, String>`                   | `TauriNotesRepository.loadAll` |
//! | `create_note` | `(draft: NoteDraft) -> Result<Note, String>`        | `.create`   |
//! | `update_note` | `(id: String, patch: NotePatch) -> Result<Note, String>` | `.update` |
//! | `delete_note` | `(id: String) -> Result<(), String>`                | `.delete`   |
//! | `list_spaces` | `() -> Result<Vec<Space>, String>`                  | `TauriSpacesRepository.loadAll` |
//!
//! `Space` est simplement `{ id: String, name: String }`.
//!
//! Règles que le front tient pour acquises :
//! - `create_note` et `update_note` **renvoient la note telle que persistée**
//!   (id définitif, `updated_at` rafraîchi). Le store remplace sa copie locale
//!   par cette valeur de retour.
//! - `update_note` sur un `id` inconnu doit renvoyer `Err`, pas un `Ok`
//!   silencieux : le store s'en sert pour annuler sa mise à jour optimiste.
//! - Le type d'erreur doit être sérialisable (`String` suffit) ; il ressort
//!   côté TypeScript encapsulé dans `IpcError` (`src/app/core/ipc/ipc.service.ts`).
//!
//! ## 3. Enregistrement
//!
//! Ajouter chaque commande à `tauri::generate_handler![...]` dans `lib.rs`,
//! sans quoi l'appel échoue à l'exécution par un « command not found » alors
//! même que le Rust compile.

// Squelette d'exemple, pas encore branché au front-end ni enregistré dans lib.rs.
#[allow(dead_code)]
#[tauri::command]
pub fn list_notes_placeholder() -> Vec<String> {
    // TODO: remplacer par les commandes décrites ci-dessus.
    vec![]
}
