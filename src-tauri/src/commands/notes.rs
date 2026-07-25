//! Module « Prise de notes ».
//!
//! Les structures et les signatures sont **figées et déjà branchées** : le
//! front-end appelle ces commandes (`src/app/core/data/tauri-notes-repository.ts`)
//! et elles sont enregistrées dans `lib.rs`. Il ne reste qu'à écrire les corps
//! de fonction — chacun porte un `TODO` décrivant ce qu'il doit faire. Tant
//! qu'ils renvoient `Err(NOT_IMPLEMENTED)`, l'application affiche l'écran de
//! reprise du canevas et le bandeau d'erreur : c'est le comportement attendu,
//! pas un bug.
//!
//! # Ce qui reste à décider (côté implémentation)
//!
//! 1. **Le support de stockage.** Un fichier JSON dans
//!    `app_handle.path().app_data_dir()` suffit pour démarrer ; SQLite (via
//!    `rusqlite` ou `tauri-plugin-sql`) devient intéressant quand le nombre de
//!    notes rend la relecture intégrale coûteuse.
//! 2. **La génération des identifiants et des dates.** Le front n'en fabrique
//!    jamais : il lit ce que ces commandes renvoient. Les crates habituelles
//!    sont `uuid` (`Uuid::new_v4()`) et `chrono` (`Utc::now().to_rfc3339()`).
//!    Aucune n'est encore déclarée dans `Cargo.toml`.
//! 3. **L'accès concurrent.** Deux commandes peuvent se chevaucher ; l'état
//!    partagé passe par `tauri::State<Mutex<...>>` (enregistré avec
//!    `.manage(...)` dans `lib.rs`), pas par une variable globale.
//!
//! Garder la logique métier (lecture/écriture disque, requêtes SQL) dans des
//! fonctions Rust ordinaires et faire de ces `#[tauri::command]` de simples
//! adaptateurs rend le tout testable sans lancer Tauri.
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
//! type date) ; `chrono::DateTime<Utc>` sérialise déjà dans ce format, ce qui
//! permettra de remplacer les `String` de dates ci-dessous sans toucher au front.
//!
//! Règles que le front tient pour acquises :
//! - `create_note` et `update_note` **renvoient la note telle que persistée**
//!   (identifiant définitif, `updated_at` rafraîchi) : le store remplace sa
//!   copie locale par cette valeur de retour.
//! - `update_note` / `delete_note` sur un identifiant inconnu renvoient `Err`,
//!   jamais un `Ok` silencieux : le store s'en sert pour annuler sa mise à jour
//!   optimiste et remettre la note dans son état précédent.
//! - Dans un `NotePatch`, un champ **absent** signifie « ne pas toucher ». Le
//!   front n'envoie jamais `null` pour cela (voir `toNotePatchDto`), donc un
//!   `Option::None` ne doit jamais écraser la valeur stockée.

use serde::{Deserialize, Serialize};

/// Réponse temporaire tant que les corps de fonction ne sont pas écrits.
/// Le message ressort tel quel dans l'interface, via `IpcError`.
const NOT_IMPLEMENTED: &str = "Commande non implémentée : voir les TODO de src-tauri/src/commands/notes.rs";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// Espace de rangement. Le front filtre dessus : une note dont le `space_id`
    /// ne correspond à aucun espace renvoyé par `list_spaces` est invisible.
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
    /// ISO 8601, ex. "2026-07-25T09:12:00Z".
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
#[allow(dead_code)] // TODO: à retirer une fois `create_note` écrite (elle lira ces champs).
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

/// Modification partielle : un champ à `None` doit rester **inchangé** en base.
#[allow(dead_code)] // TODO: à retirer une fois `update_note` écrite (elle lira ces champs).
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

/// Toutes les notes, tous espaces confondus — le filtrage par espace est fait
/// côté front, qui doit aussi pouvoir afficher « tous les espaces ».
///
/// TODO: lire le stockage et renvoyer les notes. Une liste vide est une réponse
/// valide (premier lancement) ; réserver `Err` aux vraies pannes de lecture.
#[tauri::command]
pub fn list_notes() -> Result<Vec<Note>, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// TODO: attribuer un identifiant unique, poser `created_at` = `updated_at` =
/// maintenant (ISO 8601 UTC), persister, puis renvoyer la note complète.
/// Le front remplace sa copie locale par cette valeur : ce qui est renvoyé ici
/// est ce que l'utilisateur voit.
#[tauri::command]
#[allow(unused_variables)] // TODO: à retirer une fois le corps écrit.
pub fn create_note(draft: NoteDraft) -> Result<Note, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// TODO: retrouver la note, appliquer **uniquement** les champs `Some(...)` du
/// patch, rafraîchir `updated_at`, persister, renvoyer la note mise à jour.
/// Identifiant inconnu ⇒ `Err` (le front annule alors sa mise à jour optimiste).
#[tauri::command]
#[allow(unused_variables)] // TODO: à retirer une fois le corps écrit.
pub fn update_note(id: String, patch: NotePatch) -> Result<Note, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// TODO: supprimer la note et persister. Identifiant inconnu ⇒ `Err` : le front
/// remet alors la note à sa place d'origine dans la liste.
#[tauri::command]
#[allow(unused_variables)] // TODO: à retirer une fois le corps écrit.
pub fn delete_note(id: String) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.to_string())
}
