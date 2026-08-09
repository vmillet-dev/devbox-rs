-- Index sur le langage, devenu une facette de filtrage. Sans lui,
-- `language IN (…)` et le `SELECT DISTINCT` du rail balaient tout.
--
-- Pas de `CHECK` sur la colonne : la liste des langages vit dans le domaine et
-- bouge d'une version à l'autre — la figer imposerait une migration par ajout.

CREATE INDEX notes_language ON notes (language);
