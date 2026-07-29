import { guard } from './fail-next';
import { NotesRepository } from '@features/notes/data/notes.repository';
import { Note, NoteDraft, NotePatch } from '@features/notes/model/note.model';
import { NotesQuery, NotesView } from '@features/notes/model/note.model';

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
 *
 * `Pick<…, keyof …>` is the public surface of the real class: `keyof` drops its
 * private members, which would otherwise make it nominal and unimplementable.
 * A method renamed or dropped there fails this file at compile time.
 */
export class FakeNotesRepository implements Pick<NotesRepository, keyof NotesRepository> {
  private notes: readonly Note[];
  private forcedView: NotesView | null = null;
  private nextId = 0;

  /** When set, the next call to any method rejects with this error, then clears. */
  failNext: Error | null = null;

  /** Query the store sent last, for asserting how it assembles its parameters. */
  lastQuery: NotesQuery | null = null;
  queryCount = 0;

  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;

  constructor(notes: readonly Note[] = []) {
    this.notes = notes;
  }

  /** Pins the view the backend is pretending to return, ignoring the stored notes. */
  setView(view: Partial<NotesView>): void {
    this.forcedView = { ...this.trivialView(), ...view };
  }

  /**
   * Suspends every query until `release()`. The store only reports loading
   * before its first view lands, so observing that state needs a query that
   * stays in flight.
   */
  hold(): void {
    this.gate = new Promise<void>((resolve) => (this.openGate = resolve));
  }

  release(): void {
    this.openGate?.();
    this.gate = null;
    this.openGate = null;
  }

  async query(query: NotesQuery): Promise<NotesView> {
    await this.gate;
    return guard(this, () => {
      this.lastQuery = query;
      this.queryCount += 1;
      return this.forcedView ?? this.trivialView();
    });
  }

  create(draft: NoteDraft): Promise<Note> {
    return guard(this, () => {
      const now = new Date();
      const note: Note = {
        ...draft,
        id: `fake-${++this.nextId}`,
        createdAt: now,
        updatedAt: now,
        // Derived fields: the backend decides them, so the double returns the
        // plain case rather than reimplementing the rule.
        footer: { kind: 'age', at: now },
        expiringSoon: false,
      };
      this.notes = [note, ...this.notes];
      return note;
    });
  }

  update(id: string, patch: NotePatch): Promise<Note> {
    return guard(this, () => {
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
    return guard(this, () => {
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
      availableLanguages: [...new Set(this.notes.map((note) => note.language))].sort(),
      isFiltering: false,
      matched: this.notes.length,
    };
  }
}
