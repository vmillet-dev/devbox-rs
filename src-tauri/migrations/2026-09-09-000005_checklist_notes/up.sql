-- Le type de note. `DEFAULT 'snippet'` n'est pas un confort : SQLite refuse un
-- `ADD COLUMN NOT NULL` sans défaut, et c'est aussi ce qui donne sa valeur aux
-- notes déjà en base.
--
-- Pas de `CHECK`, pour la raison qui vaut déjà pour `notes.language`
-- (migration 3) : la liste vit dans le domaine et bouge d'une version à
-- l'autre — la figer ici imposerait une migration par ajout.
ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'snippet';

-- Les items d'une todolist, dans leur propre table plutôt qu'en colonne
-- sérialisée — même raisonnement que `note_tags`. La position est dans la clé
-- primaire : elle porte l'ordre, et l'écriture réécrit la liste entière.
CREATE TABLE note_items (
    note_id  TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text     TEXT NOT NULL,
    done     INTEGER NOT NULL CHECK (done IN (0, 1)),
    PRIMARY KEY (note_id, position)
);
