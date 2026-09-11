-- What has already been typed into a note's `{{fields}}`: `host = db.internal`
-- survives closing the editor.
--
-- A table of its own rather than a serialised column, like `note_tags` and
-- `note_items`: the name carries the identity, and a write rewrites the whole set.
--
-- ⚠️ No `COLLATE NOCASE` here, unlike `note_tags`: `notes::placeholder::fill`
-- decides what a token is worth and compares the name **as written** —
-- `{{Host}}` and `{{host}}` are two distinct fields in the text, and conflating
-- them in the database would fill one with the other's value.
CREATE TABLE note_placeholders (
    note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (note_id, name)
);
