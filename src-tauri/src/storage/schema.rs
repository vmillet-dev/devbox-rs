//! Table Diesel de chaque table SQLite : le miroir typé du schéma que
//! `migrations/` construit.
//!
//! Écrit à la main plutôt que généré par `diesel print-schema`, qui exigerait
//! une base à jour sur la machine de build et rendrait `cargo check` dépendant
//! d'un fichier hors du dépôt. La contrepartie est de le tenir en phase avec les
//! migrations ; `check_for_backend` sur les structures de ligne et les tests de
//! `storage::` échouent bruyamment si les deux divergent.
//!
//! Ce qui **n'apparaît pas** ici et vit uniquement dans le SQL des migrations :
//! les `CHECK`, les `ON DELETE CASCADE` et la collation `NOCASE` de
//! `note_tags.tag`. Diesel ne les modélise pas — il les subit, ce qui est le bon
//! sens de la dépendance.

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
