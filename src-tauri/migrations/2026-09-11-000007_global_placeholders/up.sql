-- The preferences panel's "variables": `{{field}}` values valid across **the
-- whole corpus**, where `note_placeholders` keeps one per note.
--
-- They do not replace those, they sit underneath: `{{host}}` takes the value
-- typed on the note if there is one, the global variable otherwise, and only
-- failing both the default written in the text (`{{host=localhost}}`) — see
-- `notes::placeholder::resolve`.
--
-- No `COLLATE NOCASE`, for the reason that already applies to
-- `note_placeholders`.
CREATE TABLE global_placeholders (
    name  TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
);
