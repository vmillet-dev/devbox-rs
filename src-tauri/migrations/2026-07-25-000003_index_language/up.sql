-- Index on the language, now a filtering facet. Without it, `language IN (…)`
-- and the rail's `SELECT DISTINCT` scan everything.
--
-- No `CHECK` on the column: the list of languages lives in the domain and moves
-- between versions — freezing it here would force a migration per addition.

CREATE INDEX notes_language ON notes (language);
