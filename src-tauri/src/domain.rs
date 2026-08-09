//! Modèle et règles métier. Ne connaît ni Diesel ni Tauri — `scripts/check-layers.sh`
//! le vérifie, et c'est ce qui rend ces règles éprouvables sans ouvrir de base.

pub mod error;
pub mod iso8601;
pub mod language;
pub mod note;
pub mod search;
pub mod section;
pub mod space;
pub mod tag;
pub mod view;

#[cfg(test)]
pub(crate) mod fixtures;
