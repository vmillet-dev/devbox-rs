//! ⚠️ Hand-written rather than produced by `diesel print-schema`, which would make
//! `cargo check` depend on an up-to-date database outside the repository. Adding a column
//! means editing both the migration SQL and this file.
//!
//! The `CHECK`s, the `ON DELETE CASCADE`s and the `NOCASE` collations do not appear here:
//! Diesel does not model them, it simply obeys them.

diesel::table! {
    spaces (id) {
        id -> Text,
        name -> Text,
        pinned -> Bool,
    }
}

diesel::table! {
    folders (id) {
        id -> Text,
        space_id -> Text,
        name -> Text,
        colour -> Text,
        created_at -> Text,
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
        folder_id -> Nullable<Text>,
    }
}

diesel::table! {
    note_tags (note_id, tag) {
        note_id -> Text,
        tag -> Text,
    }
}

// The order *is* the list: `position` is part of the key.
diesel::table! {
    note_items (note_id, position) {
        note_id -> Text,
        position -> Integer,
        text -> Text,
        done -> Bool,
    }
}

// ⚠️ Case-sensitive where `note_tags` folds case: `{{Host}}` is not `{{host}}`.
diesel::table! {
    note_placeholders (note_id, name) {
        note_id -> Text,
        name -> Text,
        value -> Text,
    }
}

// A table of their own rather than a nullable `note_id`, which would empty the
// `note_placeholders` primary key of its meaning.
diesel::table! {
    global_placeholders (name) {
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

diesel::joinable!(folders -> spaces (space_id));
diesel::joinable!(notes -> spaces (space_id));
diesel::joinable!(note_tags -> notes (note_id));
diesel::joinable!(note_items -> notes (note_id));
diesel::joinable!(note_placeholders -> notes (note_id));
diesel::joinable!(attachments -> notes (note_id));

diesel::allow_tables_to_appear_in_same_query!(
    spaces,
    folders,
    notes,
    note_tags,
    note_items,
    note_placeholders,
    global_placeholders,
    attachments
);
