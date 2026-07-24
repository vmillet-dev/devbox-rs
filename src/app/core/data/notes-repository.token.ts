import { InjectionToken } from '@angular/core';
import { Note } from '../models/note.model';

/**
 * Point d'accès aux notes, indépendant de la source de données.
 * Implémentation actuelle : `MockNotesRepository` (données en mémoire).
 * À remplacer, une fois le backend Rust prêt, par une implémentation qui
 * appelle `invoke<Note[]>('list_notes')` sur les commandes Tauri exposées
 * dans `src-tauri/src/commands/notes.rs` — le reste de l'app (store,
 * composants) n'a pas besoin de changer.
 */
export interface NotesRepository {
  loadAll(): Promise<Note[]>;
}

export const NOTES_REPOSITORY = new InjectionToken<NotesRepository>('NOTES_REPOSITORY');
