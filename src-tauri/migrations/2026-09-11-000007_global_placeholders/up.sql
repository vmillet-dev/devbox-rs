-- Les « variables » du panneau de préférences : des valeurs de `{{champs}}`
-- valables pour **tout le corpus**, là où `note_placeholders` en garde une par
-- note.
--
-- Elles ne remplacent pas ces dernières, elles passent dessous : `{{host}}`
-- prend la valeur saisie sur la note s'il y en a une, la variable globale
-- sinon, et seulement à défaut la valeur par défaut écrite dans le texte
-- (`{{host=localhost}}`) — voir `notes::placeholder::resolve`.
--
-- Pas de `COLLATE NOCASE`, pour la raison qui vaut déjà pour
-- `note_placeholders` : `{{Host}}` et `{{host}}` sont deux jetons distincts
-- dans le texte, et les confondre ici remplirait l'un avec la valeur de l'autre.
CREATE TABLE global_placeholders (
    name  TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
);
