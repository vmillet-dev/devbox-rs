-- The note kind. `DEFAULT 'snippet'` is not a convenience: SQLite refuses an
-- `ADD COLUMN NOT NULL` without a default, and it is also what gives the notes
-- already stored their value.
--
-- No `CHECK`, for the reason that already applies to `notes.language`
-- (migration 3): the list lives in the domain and moves between versions.
ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'snippet';

-- A todo list's items, in their own table rather than a serialised column —
-- same reasoning as `note_tags`. The position is part of the primary key: it
-- carries the order, and a write rewrites the whole list.
CREATE TABLE note_items (
    note_id  TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text     TEXT NOT NULL,
    done     INTEGER NOT NULL CHECK (done IN (0, 1)),
    PRIMARY KEY (note_id, position)
);
