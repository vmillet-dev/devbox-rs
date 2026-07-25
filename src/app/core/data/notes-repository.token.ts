import { InjectionToken } from '@angular/core';
import { Note, NoteDraft, NotePatch } from '../models/note.model';

/**
 * Point d'accès aux notes, indépendant de la source de données.
 *
 * Le contrat est volontairement **complet dès maintenant** (lecture *et*
 * écriture), même si l'implémentation active est encore en mémoire : c'est ce
 * qui garantit que brancher le backend Rust ne changera qu'un provider, sans
 * rendre le store asynchrone après coup.
 *
 * Conventions imposées aux implémentations :
 * - `create` et `update` **renvoient la note telle que persistée** : c'est la
 *   couche de persistance qui attribue l'`id` et les horodatages, jamais le front.
 * - toute erreur est propagée en rejet ; le store est responsable du rollback.
 *
 * Implémentations : `MockNotesRepository` (en mémoire, active) et
 * `TauriNotesRepository` (`invoke()`, prête à être branchée) — voir `data.providers.ts`.
 */
export interface NotesRepository {
  loadAll(): Promise<readonly Note[]>;
  create(draft: NoteDraft): Promise<Note>;
  update(id: string, patch: NotePatch): Promise<Note>;
  delete(id: string): Promise<void>;
}

export const NOTES_REPOSITORY = new InjectionToken<NotesRepository>('NOTES_REPOSITORY');
