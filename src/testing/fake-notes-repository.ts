import { NotesRepository } from '@core/data/notes-repository.token';
import { Note, NoteDraft, NotePatch } from '@core/models/note.model';
import { NotesQuery, NotesView } from '@core/models/notes-query.model';

/**
 * In-memory `NotesRepository` test double.
 *
 * It deliberately does **not** reimplement filtering, grouping or tag
 * normalisation: those now live in Rust and are tested there
 * (`src-tauri/src/storage/`). Duplicating them here would let a front-end spec
 * pass against rules the real backend does not apply.
 *
 * What it does emulate is persistence — it owns the notes, assigns ids and
 * timestamps, and returns the stored note — and it wraps them in a trivial
 * single-section view. A spec that needs a specific view (search results, empty
 * results, several sections) sets one explicitly with `setView`.
 *
 * `lastQuery` and `queryCount` expose what the store asked for, which is the
 * only part of querying the front is still responsible for.
 */
export class FakeNotesRepository implements NotesRepository {
  private notes: readonly Note[];
  private forcedView: NotesView | null = null;
  private nextId = 0;

  /** When set, the next call to any method rejects with this error, then clears. */
  failNext: Error | null = null;

  /** Query the store sent last, for asserting how it assembles its parameters. */
  lastQuery: NotesQuery | null = null;
  queryCount = 0;

  constructor(notes: readonly Note[] = []) {
    this.notes = notes;
  }

  /** Pins the view the backend is pretending to return, ignoring the stored notes. */
  setView(view: Partial<NotesView>): void {
    this.forcedView = { ...this.trivialView(), ...view };
  }

  query(query: NotesQuery): Promise<NotesView> {
    return this.guard(() => {
      this.lastQuery = query;
      this.queryCount += 1;
      return this.forcedView ?? this.trivialView();
    });
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

  /** Every note in one section — the shape, not the grouping rules. */
  private trivialView(): NotesView {
    return {
      sections: [
        {
          key: 'week',
          notes: this.notes,
          hasExpiringNotes: this.notes.some((note) => note.lifecycle.kind === 'expires'),
          showCreateGhost: true,
        },
      ],
      availableTags: [...new Set(this.notes.flatMap((note) => note.tags))].sort(),
      isFiltering: false,
      matched: this.notes.length,
    };
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
