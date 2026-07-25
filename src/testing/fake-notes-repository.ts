import { NotesRepository } from '@core/data/notes-repository.token';
import { Note, NoteDraft, NotePatch } from '@core/models/note.model';

/**
 * In-memory `NotesRepository` test double.
 *
 * It behaves like real persistence — it owns the list, assigns ids and
 * timestamps, and returns the stored note — so store specs exercise the same
 * code path they will against the Rust backend.
 *
 * Every method can be made to reject via `failNext`, which is what the store's
 * optimistic-update rollback needs in order to be tested at all.
 */
export class FakeNotesRepository implements NotesRepository {
  private notes: readonly Note[];
  private nextId = 0;

  /** When set, the next call to any method rejects with this error, then clears. */
  failNext: Error | null = null;

  constructor(notes: readonly Note[] = []) {
    this.notes = notes;
  }

  loadAll(): Promise<readonly Note[]> {
    return this.guard(() => this.notes);
  }

  create(draft: NoteDraft): Promise<Note> {
    return this.guard(() => {
      const now = new Date();
      const note: Note = { ...draft, id: `fake-${++this.nextId}`, createdAt: now, updatedAt: now };
      this.notes = [note, ...this.notes];
      return note;
    });
  }

  update(id: string, patch: NotePatch): Promise<Note> {
    return this.guard(() => {
      const existing = this.notes.find((note) => note.id === id);
      if (!existing) {
        throw new Error(`Unknown note: ${id}`);
      }
      const updated: Note = { ...existing, ...patch, updatedAt: new Date() };
      this.notes = this.notes.map((note) => (note.id === id ? updated : note));
      return updated;
    });
  }

  delete(id: string): Promise<void> {
    return this.guard(() => {
      this.notes = this.notes.filter((note) => note.id !== id);
    });
  }

  private guard<T>(operation: () => T): Promise<T> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return Promise.reject(error);
    }
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
