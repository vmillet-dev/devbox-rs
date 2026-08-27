-- Corbeille et pièces jointes.
--
-- `deleted_at` plutôt qu'un booléen : la purge à 30 jours a besoin de la date,
-- et le panneau de corbeille affiche l'échéance. NULL = note vivante, ce qui
-- laisse l'index partiel ne porter que sur les lignes supprimées.

ALTER TABLE notes ADD COLUMN deleted_at TEXT;

CREATE INDEX notes_deleted_at ON notes (deleted_at) WHERE deleted_at IS NOT NULL;

-- Les octets ne sont pas ici : ils vivent dans `app_data_dir()/attachments/`,
-- sous un nom dérivé de l'identifiant. Une base qui grossit de 10 Mo par capture
-- d'écran rendrait chaque lecture de note plus lente.
CREATE TABLE attachments (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    file_name  TEXT NOT NULL,
    mime_type  TEXT NOT NULL,
    byte_size  INTEGER NOT NULL CHECK (byte_size >= 0),
    created_at TEXT NOT NULL
);

CREATE INDEX attachments_note_id ON attachments (note_id);
