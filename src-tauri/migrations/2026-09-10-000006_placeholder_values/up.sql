-- Ce qu'on a déjà tapé dans les `{{champs}}` d'une note : `host = db.internal`
-- survit à la fermeture de l'éditeur, sinon le panneau ne vaudrait pas mieux que
-- la modale qu'il remplace.
--
-- Table à part plutôt qu'une colonne sérialisée, comme `note_tags` et
-- `note_items` : le nom porte l'identité, et une écriture réécrit l'ensemble.
--
-- ⚠️ Pas de `COLLATE NOCASE` ici, contrairement à `note_tags` : c'est
-- `notes::placeholder::fill` qui décide ce qu'un jeton vaut, et il compare le
-- nom **tel quel** — `{{Host}}` et `{{host}}` sont deux champs distincts dans le
-- texte, les confondre en base remplirait l'un avec la valeur de l'autre.
CREATE TABLE note_placeholders (
    note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (note_id, name)
);
