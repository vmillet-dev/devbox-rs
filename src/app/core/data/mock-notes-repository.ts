import { Injectable } from '@angular/core';
import { Note, NoteDraft, NotePatch } from '../models/note.model';
import { NotesRepository } from './notes-repository.token';
import { MOCK_NOTES } from './notes.mock-data';

/**
 * Dépôt en mémoire utilisé tant que le backend Rust n'expose pas les commandes
 * de notes. Il tient volontairement le même rôle que la vraie persistance :
 * il possède la liste, attribue les identifiants et les horodatages, et renvoie
 * la note telle que « stockée ». Les modifications survivent donc à la
 * navigation, mais pas au redémarrage de l'app.
 */
@Injectable()
export class MockNotesRepository implements NotesRepository {
  private notes: readonly Note[] = MOCK_NOTES;

  loadAll(): Promise<readonly Note[]> {
    return Promise.resolve(this.notes);
  }

  create(draft: NoteDraft): Promise<Note> {
    const now = new Date();
    const note: Note = { ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.notes = [note, ...this.notes];
    return Promise.resolve(note);
  }

  update(id: string, patch: NotePatch): Promise<Note> {
    const existing = this.notes.find((note) => note.id === id);
    if (!existing) {
      return Promise.reject(new Error(`Note introuvable : ${id}`));
    }
    const updated: Note = { ...existing, ...patch, updatedAt: new Date() };
    this.notes = this.notes.map((note) => (note.id === id ? updated : note));
    return Promise.resolve(updated);
  }

  delete(id: string): Promise<void> {
    this.notes = this.notes.filter((note) => note.id !== id);
    return Promise.resolve();
  }
}
