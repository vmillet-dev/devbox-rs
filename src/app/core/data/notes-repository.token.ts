import { InjectionToken } from '@angular/core';
import { Note, NoteDraft, NotePatch } from '../models/note.model';
import { NotesQuery, NotesView } from '../models/notes-query.model';

/**
 * Point d'accès aux notes, indépendant de la source de données.
 *
 * Conventions imposées aux implémentations :
 * - `query` renvoie une **vue déjà filtrée et regroupée** : il n'existe pas de
 *   méthode rendant la liste brute, précisément pour qu'aucun appelant ne soit
 *   tenté de refiltrer.
 * - `create` et `update` **renvoient la note telle que persistée** : c'est la
 *   couche de persistance qui attribue l'`id` et les horodatages, jamais le front.
 * - toute erreur est propagée en rejet ; le store notifie et recharge.
 *
 * Implémentations : `TauriNotesRepository` (le backend Rust, seule source de
 * données de l'application — voir `data.providers.ts`) et `FakeNotesRepository`
 * (`src/testing/`, réservée aux specs).
 */
export interface NotesRepository {
  query(query: NotesQuery): Promise<NotesView>;
  create(draft: NoteDraft): Promise<Note>;
  update(id: string, patch: NotePatch): Promise<Note>;
  delete(id: string): Promise<void>;
}

export const NOTES_REPOSITORY = new InjectionToken<NotesRepository>('NOTES_REPOSITORY');
