-- Replie la casse des tags **entre** notes, là où `rules::normalize_tags` ne la
-- repliait qu'au sein d'une note : `Urgent` et `urgent` produisaient deux
-- facettes dans le rail, dont `tag IN (…)` n'en retrouvait qu'une.
--
-- La collation d'une colonne ne s'altère pas, d'où la table recréée ;
-- `INSERT OR IGNORE` absorbe les doublons que la nouvelle clé primaire fusionne.

CREATE TABLE note_tags_v2 (
    note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag     TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (note_id, tag)
);

INSERT OR IGNORE INTO note_tags_v2 (note_id, tag) SELECT note_id, tag FROM note_tags;

DROP TABLE note_tags;
ALTER TABLE note_tags_v2 RENAME TO note_tags;

CREATE INDEX note_tags_tag ON note_tags (tag);
