//! Miroir typé du schéma que `migrations/` construit.
//!
//! Écrit à la main plutôt que par `diesel print-schema`, qui rendrait
//! `cargo check` dépendant d'une base à jour hors du dépôt. La contrepartie est
//! de le tenir en phase ; `check_for_backend` sur `NoteRow` fait échouer la
//! compilation si les deux divergent.
//!
//! Les `CHECK`, les `ON DELETE CASCADE` et la collation `NOCASE` n'apparaissent
//! **pas** ici : Diesel ne les modélise pas, il les subit.

diesel::table! {
    spaces (id) {
        id -> Text,
        name -> Text,
    }
}

diesel::table! {
    notes (id) {
        id -> Text,
        space_id -> Text,
        title -> Text,
        language -> Text,
        content -> Text,
        source -> Text,
        pinned -> Bool,
        created_at -> Text,
        updated_at -> Text,
        lifecycle_kind -> Text,
        lifecycle_expires_at -> Nullable<Text>,
    }
}

diesel::table! {
    note_tags (note_id, tag) {
        note_id -> Text,
        tag -> Text,
    }
}

diesel::joinable!(notes -> spaces (space_id));
diesel::joinable!(note_tags -> notes (note_id));

diesel::allow_tables_to_appear_in_same_query!(spaces, notes, note_tags);
