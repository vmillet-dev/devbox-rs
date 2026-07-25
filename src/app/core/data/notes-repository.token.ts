import { InjectionToken } from '@angular/core';
import { Note, NoteDraft, NotePatch } from '../models/note.model';

/**
 * Point d'accès aux notes, indépendant de la source de données.
 *
 * Conventions imposées aux implémentations :
 * - `create` et `update` **renvoient la note telle que persistée** : c'est la
 *   couche de persistance qui attribue l'`id` et les horodatages, jamais le front.
 * - toute erreur est propagée en rejet ; le store est responsable du rollback.
 *
 * Implémentations : `TauriNotesRepository` (le backend Rust, seule source de
 * données de l'application — voir `data.providers.ts`) et `FakeNotesRepository`
 * (`src/testing/`, réservée aux specs).
 */
export interface NotesRepository {
  loadAll(): Promise<readonly Note[]>;
  create(draft: NoteDraft): Promise<Note>;
  update(id: string, patch: NotePatch): Promise<Note>;
  delete(id: string): Promise<void>;
}

export const NOTES_REPOSITORY = new InjectionToken<NotesRepository>('NOTES_REPOSITORY');
