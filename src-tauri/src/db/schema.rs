//! A typed mirror of the schema that `migrations/` builds.
//!
//! Hand-written rather than produced by `diesel print-schema`, which would make
//! `cargo check` depend on an up-to-date database outside the repository. The
//! price is keeping it in step; `check_for_backend` on `NoteRow` turns a
//! divergence into a compile error.
//!
//! The `CHECK`s, the `ON DELETE CASCADE`s and the `NOCASE` collation do **not**
//! appear here: Diesel does not model them, it simply obeys them.

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
        deleted_at -> Nullable<Text>,
        kind -> Text,
    }
}

diesel::table! {
    note_tags (note_id, tag) {
        note_id -> Text,
        tag -> Text,
    }
}

// The order *is* the list: `position` is part of the key, and a write rewrites
// the whole sequence rather than shifting rows one by one.
diesel::table! {
    note_items (note_id, position) {
        note_id -> Text,
        position -> Integer,
        text -> Text,
        done -> Bool,
    }
}

// The name *is* the identity, and it is compared byte for byte: `notes::placeholder`
// tells `{{Host}}` from `{{host}}`, so this key stays case-sensitive where
// `note_tags` folds case.
diesel::table! {
    note_placeholders (note_id, name) {
        note_id -> Text,
        name -> Text,
        value -> Text,
    }
}

diesel::table! {
    attachments (id) {
        id -> Text,
        note_id -> Text,
        file_name -> Text,
        mime_type -> Text,
        byte_size -> BigInt,
        created_at -> Text,
    }
}

diesel::joinable!(notes -> spaces (space_id));
diesel::joinable!(note_tags -> notes (note_id));
diesel::joinable!(note_items -> notes (note_id));
diesel::joinable!(note_placeholders -> notes (note_id));
diesel::joinable!(attachments -> notes (note_id));

diesel::allow_tables_to_appear_in_same_query!(
    spaces,
    notes,
    note_tags,
    note_items,
    note_placeholders,
    attachments
);
