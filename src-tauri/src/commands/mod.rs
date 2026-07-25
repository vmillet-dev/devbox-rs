//! Point d'entrée unique pour toutes les commandes Tauri exposées au front-end Angular.
//!
//! Chaque domaine fonctionnel de DevBox possède son propre fichier :
//! - `greetings`  : commande de démonstration ("Hello World")
//! - `notes`      : prise de notes                  (signatures figées, corps à écrire)
//! - `spaces`     : espaces de rangement des notes  (signatures figées, corps à écrire)
//! - `crypto`     : hashing / chiffrement           (à implémenter)
//! - `formatters` : encodage, décodage, formatage   (à implémenter)
//!
//! Pour ajouter une nouvelle commande :
//! 1. L'écrire dans le fichier du domaine concerné (ou en créer un nouveau ici).
//! 2. La déclarer `pub` et l'annoter avec `#[tauri::command]`.
//! 3. L'enregistrer dans `tauri::generate_handler![...]` au sein de `lib.rs`.

pub mod greetings;
pub mod notes;
pub mod spaces;
pub mod crypto;
pub mod formatters;
