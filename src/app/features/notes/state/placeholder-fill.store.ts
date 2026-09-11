import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { StatusNotifier } from '@core/notifications/status.service';
import { Note } from '../model/note.model';
import { FillRequest } from '../ui/note-editor-overlay/note-editor-overlay.component';
import { NoteCopyService } from './note-copy.service';
import { NotesQueryStore } from './notes-query.store';
import { NotesStore } from './notes.store';
import { PaletteStore } from './palette.store';

/**
 * Filling a snippet's `{{fields}}` before copying it, from wherever it is
 * asked: a card, the palette, or the editor's preview.
 *
 * The filling itself is `notes::placeholder::fill`'s — what is here is the
 * order of operations, which is the same in all three cases: fill, copy, and
 * **keep** the values. There is one set per note, so filling twice in a row at
 * the same place must not ask the same thing twice.
 */
@Injectable({ providedIn: 'root' })
export class PlaceholderFillStore {
  private readonly notes = inject(NotesStore);
  private readonly canvas = inject(NotesQueryStore);
  private readonly palette = inject(PaletteStore);
  private readonly copier = inject(NoteCopyService);
  private readonly status = inject(StatusNotifier);

  private readonly _target = signal<Note | null>(null);
  private readonly _preview = signal<string | null>(null);

  /** The note whose fields are being typed outside the palette, or `null`. */
  readonly target = this._target.asReadonly();

  /** The filled body the editor preview shows; `null` before the first request. */
  readonly preview = this._preview.asReadonly();

  readonly placeholders = computed(() => this._target()?.placeholders ?? []);

  /**
   * The last preview request sent. Filling crosses the bridge, and two answers
   * can come back out of order: only the current request may render.
   */
  private latestRequest: FillRequest | null = null;

  constructor() {
    // A preview belongs to the note that asked for it: keeping it while opening
    // the next would show the previous note's filled body for a round trip.
    effect(() => {
      this.notes.selectedNoteId();
      this.latestRequest = null;
      this._preview.set(null);
    });
  }

  /** Opens the form on a card's note. */
  openFor(noteId: string): void {
    this._target.set(this.canvas.visibleNotes().find((note) => note.id === noteId) ?? null);
  }

  cancel(): void {
    this._target.set(null);
  }

  async submit(values: Record<string, string>): Promise<void> {
    const note = this._target();
    if (!note) return;

    this._target.set(null);
    await this.copier.copy(await this.notes.fillPlaceholders(note.content, values));
    await this.notes.setPlaceholderValues(note.id, values);
  }

  /** "Copy as is", for a note that holds template code without being a snippet. */
  async copyRaw(): Promise<void> {
    const note = this._target();
    this._target.set(null);
    if (note) {
      await this.copier.copy(note.content);
    }
  }

  /** The editor preview: this fills, the editor displays. */
  async refreshPreview(request: FillRequest): Promise<void> {
    this.latestRequest = request;
    const filled = await this.notes.fillPlaceholders(request.content, request.values);

    if (this.latestRequest === request) {
      this._preview.set(filled);
    }
  }

  /**
   * Copy from the editor. The acknowledgement goes through the status banner
   * rather than the button's tick: the text only exists once the bridge has
   * been crossed, and ticking early would announce a copy that did not happen.
   */
  async copyFilled(request: FillRequest): Promise<void> {
    const filled = await this.notes.fillPlaceholders(request.content, request.values);

    if (await this.copier.copy(filled)) {
      this.status.notify({ key: 'placeholders.copiedFilled' });
    }
  }

  /** The palette's own form, which sits in front of it while it stays open. */
  async submitForPalette(values: Record<string, string>): Promise<void> {
    const note = this.palette.pendingFill();
    if (!note) return;

    await this.palette.copyAndDismiss(await this.notes.fillPlaceholders(note.content, values));
    // Kept as elsewhere: the palette fills the same note as the editor.
    await this.notes.setPlaceholderValues(note.id, values);
  }
}
