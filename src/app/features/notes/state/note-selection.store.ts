import { Injectable, computed, inject, signal } from '@angular/core';
import { Note } from '../model/note.model';
import { NotesQueryStore } from './notes-query.store';

/**
 * Both are **positions in the visible list**, which is why they live together and
 * next to it: a range selection spans from the focused note to the clicked one, and
 * neither survives a note leaving the view.
 */
@Injectable({ providedIn: 'root' })
export class NoteSelectionStore {
  private readonly notes = inject(NotesQueryStore);

  private readonly _focusedNoteId = signal<string | null>(null);
  private readonly _checkedIds = signal<ReadonlySet<string>>(new Set());

  readonly focusedNoteId = this._focusedNoteId.asReadonly();
  readonly checkedIds = this._checkedIds.asReadonly();

  /**
   * Derived from what is visible, never read raw: an id ticked then gone must not
   * travel into a bulk action.
   */
  readonly checkedNotes = computed<readonly Note[]>(() => {
    const checked = this._checkedIds();
    return this.notes.visibleNotes().filter((note) => checked.has(note.id));
  });

  readonly checkedCount = computed(() => this.checkedNotes().length);
  readonly hasSelection = computed(() => this.checkedCount() > 0);

  readonly checkedNoteIds = computed<readonly string[]>(() => this.checkedNotes().map((note) => note.id));

  /** `null` takes focus off the canvas — when a modal opens, for instance. */
  focusNote(id: string | null): void {
    this._focusedNoteId.set(id);
  }

  focusedIndex(): number {
    const focused = this._focusedNoteId();
    return focused === null ? -1 : this.notes.visibleNotes().findIndex((note) => note.id === focused);
  }

  focusedNote(): Note | null {
    const index = this.focusedIndex();
    return index < 0 ? null : (this.notes.visibleNotes()[index] ?? null);
  }

  /**
   * By position rather than by id: navigation reasons in indices, the only landmark
   * that survives a renamed note.
   */
  focusIndex(index: number): void {
    const note = this.notes.visibleNotes()[index];
    if (note) {
      this._focusedNoteId.set(note.id);
    }
  }

  toggleChecked(id: string): void {
    this._checkedIds.update((checked) => {
      const next = new Set(checked);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** A file list's Shift+click. With no anchor, this ticks the named note alone. */
  checkRangeTo(id: string): void {
    const visible = this.notes.visibleNotes();
    const anchor = this.focusedIndex();
    const target = visible.findIndex((note) => note.id === id);
    if (target < 0) return;

    const from = anchor < 0 ? target : Math.min(anchor, target);
    const to = anchor < 0 ? target : Math.max(anchor, target);

    this._checkedIds.update((checked) => {
      const next = new Set(checked);
      for (const note of visible.slice(from, to + 1)) {
        next.add(note.id);
      }
      return next;
    });
    this._focusedNoteId.set(id);
  }

  clearSelection(): void {
    this._checkedIds.set(new Set());
  }
}
