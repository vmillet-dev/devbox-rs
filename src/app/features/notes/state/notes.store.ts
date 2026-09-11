import { Injectable, computed, inject, signal } from '@angular/core';
import { NotesRepository } from '../data/notes.repository';
import { ClipboardService } from '@core/clipboard/clipboard.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FALLBACK_LANGUAGE } from '@core/language/language.model';
import { ChecklistItem, Note, NoteDraft, NoteKind, NoteLifecycle, NotePatch } from '../model/note.model';
import { ClockService } from '@core/time/clock.service';
import { debounced } from '@core/time/debounce';
import { NoteSelectionStore } from './note-selection.store';
import { NotesQueryStore } from './notes-query.store';
import { SpacesStore } from './spaces.store';

export type { NoteFilter, NoteKind } from '../model/note.model';

/** How long undo stays offered. The note is not lost after that: it is in the trash for 30 days. */
export const UNDO_WINDOW_MS = 8000;

/** What an undo needs to take back. */
export interface Deletion {
  readonly ids: readonly string[];
  readonly count: number;
}

/**
 * The note being created, **never persisted**.
 *
 * Opening creation writes nothing: one empty note per opening would turn the
 * canvas into a pile of things to tidy up.
 */
export const DRAFT_ID = '__draft__';

/**
 * What tells a note worth keeping from one to abandon. A tag or a deadline is
 * enough — and so is an item, since a todo list has no body and would otherwise
 * stay local and vanish on close.
 */
function isWorthSaving(note: Note): boolean {
  return (
    note.title.trim() !== '' ||
    note.content.trim() !== '' ||
    note.source.trim() !== '' ||
    note.tags.length > 0 ||
    note.items.length > 0 ||
    note.pinned ||
    note.lifecycle.kind === 'expires'
  );
}

/**
 * Empty title and source: the UI renders translated placeholders, and storing
 * "New note" would freeze one language into the data. `txt` means "nothing
 * chosen", which `create_note` replaces with a detection on the content.
 */
function emptyDraft(spaceId: string, kind: NoteKind): NoteDraft {
  return {
    spaceId,
    title: '',
    language: FALLBACK_LANGUAGE,
    content: '',
    source: '',
    tags: [],
    pinned: false,
    lifecycle: { kind: 'permanent' },
    kind,
    items: [],
  };
}

/**
 * The draft seen as a `Note`, so the editor need not know two shapes. The
 * derived fields carry neutral values: they come from the back end, which has
 * not seen this note yet.
 */
function emptyNote(spaceId: string, now: Date, kind: NoteKind): Note {
  return {
    ...emptyDraft(spaceId, kind),
    id: DRAFT_ID,
    createdAt: now,
    updatedAt: now,
    footer: { kind: 'age', at: now },
    expiringSoon: false,
    placeholders: [],
    attachmentCount: 0,
    // A draft todo list has no stored items yet, so nothing to render.
    copyText: null,
  };
}

/** What goes to `create_note`: the draft without its derived fields. */
function toDraftPayload(note: Note): NoteDraft {
  return {
    spaceId: note.spaceId,
    title: note.title,
    language: note.language,
    content: note.content,
    source: note.source,
    tags: [...note.tags],
    pinned: note.pinned,
    lifecycle: note.lifecycle,
    kind: note.kind,
    items: note.items.map((item) => ({ ...item })),
  };
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameItems(a: readonly ChecklistItem[], b: readonly ChecklistItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => item.text === b[index]?.text && item.done === b[index]?.done)
  );
}

/**
 * By **value**: `Date` compares by identity, so replaying the same deadline
 * would trigger a write on every pass through the date field.
 */
function sameLifecycle(a: NoteLifecycle, b: NoteLifecycle): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'expires' || a.at.getTime() === (b as { at: Date }).at.getTime();
}

/**
 * How each field decides it has not moved.
 *
 * ⚠️ Exhaustive by construction: a field added to `NoteDraft` stops this table
 * compiling until it says how to compare itself. `Date` and arrays compare by
 * identity, and a patch replaying a value already stored would otherwise make a
 * write — which refreshes `updatedAt` and floats the note to the top of the
 * canvas for nothing.
 */
const UNCHANGED: {
  readonly [K in keyof Required<NotePatch>]: (current: Note[K], next: Required<NotePatch>[K]) => boolean;
} = {
  spaceId: Object.is,
  title: Object.is,
  language: Object.is,
  content: Object.is,
  source: Object.is,
  pinned: Object.is,
  kind: Object.is,
  tags: sameStrings,
  items: sameItems,
  lifecycle: sameLifecycle,
};

/** The fields of `patch` that actually move the note. */
function changedFields(note: Note, patch: NotePatch): NotePatch {
  const changed: Record<string, unknown> = {};

  for (const key of Object.keys(patch) as (keyof NotePatch)[]) {
    const next = patch[key];
    // An absent key is "do not touch", which is what serde reads on the far side.
    if (next === undefined) continue;

    const unchanged = UNCHANGED[key] as (current: unknown, next: unknown) => boolean;
    if (!unchanged(note[key], next)) {
      changed[key] = next;
    }
  }

  return changed;
}

/**
 * The open note: creating it, writing to it, throwing it away.
 *
 * Which notes the canvas shows belongs to [`NotesQueryStore`], and which one it
 * points at to [`NoteSelectionStore`]; what is left here is the note itself.
 *
 * Two rules: writable signals stay private (every mutation goes through a
 * method), and **the back end decides** — persist then reload, so there is
 * nothing to roll back on failure.
 */
@Injectable({ providedIn: 'root' })
export class NotesStore {
  private readonly repository = inject(NotesRepository);
  private readonly clipboard = inject(ClipboardService);
  private readonly clock = inject(ClockService);
  private readonly notifier = inject(ErrorNotifier);
  private readonly spaces = inject(SpacesStore);
  private readonly notes = inject(NotesQueryStore);
  private readonly selection = inject(NoteSelectionStore);

  private readonly _selectedNote = signal<Note | null>(null);
  private readonly _draftNote = signal<Note | null>(null);
  private readonly _lastDeletion = signal<Deletion | null>(null);
  private readonly _undoVisible = signal(false);

  /** The draft wins: while it exists, it is what the editor shows. */
  readonly selectedNote = computed<Note | null>(() => this._draftNote() ?? this._selectedNote());
  readonly selectedNoteId = computed<string | null>(() => this.selectedNote()?.id ?? null);

  /**
   * The id actually in the database, or `null` while the open note is only a
   * draft. What anything needing a real row must read — attachments, say.
   */
  readonly persistedNoteId = computed<string | null>(() => this._selectedNote()?.id ?? null);
  readonly lastDeletion = this._lastDeletion.asReadonly();

  /** What the banner shows: the same deletion, while it is still offered. */
  readonly undoBanner = computed<Deletion | null>(() => (this._undoVisible() ? this._lastDeletion() : null));

  private readonly hideUndoBanner = debounced(() => this._undoVisible.set(false), UNDO_WINDOW_MS);

  /**
   * The real id the draft took once saved.
   *
   * ⚠️ Load-bearing: closing the editor commits the title **then** the content
   * with no change detection in between, so the second call still carries
   * `DRAFT_ID` while the note already exists.
   */
  private draftMaterialisedAs: string | null = null;

  openNote(id: string): void {
    this.discardDraft();
    this._selectedNote.set(this.find(id));
    this.selection.focusNote(id);
  }

  /** A draft still empty on close is abandoned, not saved. */
  closeOverlay(): void {
    this.discardDraft();
    this._selectedNote.set(null);
  }

  // --- Writing to a note -----------------------------------------------------

  /**
   * The single write for a note's own fields: title, body, source, language,
   * tags, pin, deadline, space, items.
   *
   * The editor sends what it changed and this drops what has not moved, so
   * closing on an untouched note makes no round trip. There is deliberately no
   * setter per field: nine of them made a new field a four-file change, and the
   * "has it moved?" rule was written out nine times.
   *
   * No normalisation either — trim, leading `#` and duplicate tags are decided
   * by `notes::model::normalize_tags`, the only place that rule lives.
   */
  applyPatch(id: string, patch: NotePatch): Promise<void> {
    return this.edit(id, (note) => {
      const changes = changedFields(note, patch);
      return Object.keys(changes).length === 0 ? null : changes;
    });
  }

  togglePinned(id: string): Promise<void> {
    return this.edit(id, (note) => ({ pinned: !note.pinned }));
  }

  /**
   * `spaceId` is the only field the front pushes without the user typing it,
   * and the only one storage refuses when the space is gone.
   */
  moveNote(id: string, spaceId: string): Promise<void> {
    return this.applyPatch(id, { spaceId });
  }

  /**
   * Replaces the **whole** list — ticking, renaming, adding, removing and
   * reordering all go through here, because no item has an identity of its own:
   * its position is all that designates it.
   */
  setChecklist(id: string, items: readonly ChecklistItem[]): Promise<void> {
    return this.applyPatch(id, { items });
  }

  // --- Creating --------------------------------------------------------------

  /**
   * Opens the editor on a **local draft**: nothing is written until the note is
   * worth keeping.
   *
   * In "all spaces" mode the note goes to the first one — one has to be picked.
   * With no space at all it is refused outright: a note without a space would
   * be invisible the moment a space filter is set.
   */
  createNote(kind: NoteKind = 'snippet'): void {
    const spaceId = this.spaceForNewNote();
    if (!spaceId) return;

    this._selectedNote.set(null);
    this.draftMaterialisedAs = null;
    this._draftNote.set(emptyNote(spaceId, this.clock.now(), kind));
  }

  /** A note made from the clipboard, triggered by the global shortcut. */
  async captureFromClipboard(): Promise<void> {
    await this.createWithContent(await this.clipboard.paste());
  }

  /**
   * A note created in one gesture because it already has its content. No draft
   * here — there is nothing to wait for, and the editor opens on a saved note.
   */
  async createWithContent(content: string): Promise<void> {
    if (!content.trim()) return;

    const spaceId = this.spaceForNewNote();
    if (!spaceId) return;

    await this.persistNew({ ...emptyDraft(spaceId, 'snippet'), content });
  }

  /**
   * Forces the draft to be saved and returns its real id.
   *
   * Used by whatever needs an **existing** note — attaching a file targets a
   * database row. Answers `null` when there is nothing to save.
   */
  async materialiseDraft(): Promise<string | null> {
    const persisted = this.persistedNoteId();
    if (persisted) return persisted;

    const draft = this._draftNote();
    if (!draft) return null;

    return this.saveDraft(draft);
  }

  // --- Deleting, and taking it back ------------------------------------------

  /** Moves to the trash and offers the undo. The note stays there for 30 days. */
  async deleteNote(id: string): Promise<void> {
    const resolved = this.resolve(id);

    // A draft exists nowhere: nothing to trash, so nothing to undo either.
    if (resolved === DRAFT_ID) {
      this.closeOverlay();
      return;
    }

    if (!this.find(resolved)) return;

    const deleted = await this.notifier.attempt('errors.noteDeleteFailed', () =>
      this.repository.delete(resolved),
    );
    if (deleted === null) return;

    if (this.selectedNoteId() === resolved) {
      this.closeOverlay();
    }
    this.openUndoWindow({ ids: [resolved], count: 1 });
    this.notes.reload();
  }

  /**
   * The bulk actions follow the same rule as the single writes: the back end
   * decides, we reload, nothing is applied locally.
   */
  async moveSelection(spaceId: string): Promise<void> {
    await this.runOnSelection((ids) => this.repository.moveMany(ids, spaceId));
  }

  async tagSelection(tag: string): Promise<void> {
    if (!tag.trim()) return;
    // No normalisation here: `notes::model::normalize_tags` is its only keeper.
    await this.runOnSelection((ids) => this.repository.tagMany(ids, [tag]));
  }

  async deleteSelection(): Promise<void> {
    const ids = this.selection.checkedNoteIds();
    if (ids.length === 0) return;

    const count = await this.notifier.attempt('errors.bulkActionFailed', () =>
      this.repository.deleteMany(ids),
    );
    if (count === null) return;

    this.selection.clearSelection();
    this.openUndoWindow({ ids, count });
    this.notes.reload();
  }

  async undoDeletion(): Promise<void> {
    const deletion = this._lastDeletion();
    if (!deletion) return;

    this.dismissUndo();
    const restored = await this.notifier.attempt('errors.trashActionFailed', () =>
      this.repository.restore(deletion.ids),
    );
    if (restored !== null) this.notes.reload();
  }

  /**
   * Hiding the banner **gives up** the undo: an explicit gesture, unlike the
   * timer expiring, which only tidies the display away.
   */
  dismissUndo(): void {
    this.hideUndoBanner.cancel();
    this._undoVisible.set(false);
    this._lastDeletion.set(null);
  }

  // --- `{{fields}}` ----------------------------------------------------------

  /**
   * Stores what was typed into a note's `{{fields}}`.
   *
   * ⚠️ Outside `edit()` and `NotePatch`: filling a field is not editing the
   * note. The back end leaves `updatedAt` where it is, so the note does not
   * float to the top of the canvas for a value typed in the panel.
   */
  async setPlaceholderValues(id: string, values: Record<string, string>): Promise<void> {
    const resolved = this.resolve(id);
    const target = resolved === DRAFT_ID ? await this.materialiseDraft() : resolved;
    if (!target) return;

    const saved = await this.notifier.attempt('errors.noteSaveFailed', () =>
      this.repository.setPlaceholderValues(target, values),
    );
    if (!saved) return;

    if (this.persistedNoteId() === target) {
      this._selectedNote.set(saved);
    }
    // The cards carry the same values: the filled copy from the canvas starts
    // from them.
    this.notes.reload();
  }

  /**
   * Fills a piece of content's `{{fields}}`. The back end is the only judge of
   * what is a field and what is Angular template code.
   */
  fillPlaceholders(content: string, values: Record<string, string>): Promise<string> {
    return this.repository.fillPlaceholders(content, values);
  }

  // --- Internals -------------------------------------------------------------

  private spaceForNewNote(): string | null {
    const spaceId = this.spaces.activeSpaceId() ?? this.spaces.spaces()[0]?.id;
    if (!spaceId) {
      this.notifier.notify({ ref: { key: 'errors.spaceRequired' } });
      return null;
    }

    return spaceId;
  }

  /** Writes the draft and adopts the returned note. The one place `DRAFT_ID` stops existing. */
  private async saveDraft(draft: Note): Promise<string | null> {
    const created = await this.persistNew(toDraftPayload(draft));
    if (!created) return null;

    this.draftMaterialisedAs = created.id;
    this._draftNote.set(null);

    return created.id;
  }

  private async persistNew(payload: NoteDraft): Promise<Note | null> {
    const created = await this.notifier.attempt('errors.noteCreateFailed', () =>
      this.repository.create(payload),
    );
    if (!created) return null;

    this._selectedNote.set(created);
    this.selection.focusNote(created.id);
    this.notes.reload();
    return created;
  }

  private discardDraft(): void {
    this._draftNote.set(null);
    this.draftMaterialisedAs = null;
  }

  private async runOnSelection(action: (ids: readonly string[]) => Promise<number>): Promise<void> {
    const ids = this.selection.checkedNoteIds();
    if (ids.length === 0) return;

    const done = await this.notifier.attempt('errors.bulkActionFailed', () => action(ids));
    if (done !== null) this.notes.reload();
  }

  /**
   * ⚠️ The banner fades, **the deletion stays undoable**. The two states are
   * distinct so `Ctrl+Z` still works after the banner is gone: hiding a
   * suggestion is not withdrawing it.
   */
  private openUndoWindow(deletion: Deletion): void {
    this._lastDeletion.set(deletion);
    this._undoVisible.set(true);
    this.hideUndoBanner(undefined);
  }

  /**
   * The shape shared by every write: find the note, decide the patch, persist.
   * `changes` answers `null` when nothing moved — a missing note and a no-op
   * edit both produce no round trip.
   */
  private async edit(id: string, changes: (note: Note) => NotePatch | null): Promise<void> {
    const resolved = this.resolve(id);
    const target = this.find(resolved);
    const patch = target && changes(target);
    if (!patch) return;

    if (resolved === DRAFT_ID) {
      await this.editDraft(target, patch);
      return;
    }

    await this.persist(resolved, patch);
  }

  /**
   * A write on a draft stays **local** while the note is not worth keeping:
   * changing an empty note's language must not make it appear on the canvas.
   */
  private async editDraft(draft: Note, patch: NotePatch): Promise<void> {
    const updated: Note = { ...draft, ...patch };

    if (!isWorthSaving(updated)) {
      this._draftNote.set(updated);
      return;
    }

    await this.saveDraft(updated);
  }

  /**
   * `DRAFT_ID` names the draft **or** the note it became: the editor chains
   * several commits with no change detection in between, and so keeps sending
   * the old id.
   */
  private resolve(id: string): string {
    return id === DRAFT_ID && this.draftMaterialisedAs ? this.draftMaterialisedAs : id;
  }

  /**
   * Persists then reloads. The returned note decides: it carries what the back
   * end actually wrote (`updatedAt`, normalised tags, card footer).
   *
   * `NotePatch` and not `Partial<Note>`: the latter would let `id`, `createdAt`
   * or `footer` through to the repository boundary.
   */
  private async persist(id: string, patch: NotePatch): Promise<void> {
    const saved = await this.notifier.attempt('errors.noteSaveFailed', () =>
      this.repository.update(id, patch),
    );
    if (!saved) return;

    if (this.persistedNoteId() === id) {
      this._selectedNote.set(saved);
    }
    this.notes.reload();
  }

  /**
   * The open note is consulted first: it may have left the filtered view since
   * it was opened without ceasing to be editable.
   */
  private find(id: string): Note | null {
    const draft = this._draftNote();
    if (draft?.id === id) return draft;

    const selected = this._selectedNote();
    if (selected?.id === id) return selected;

    return this.notes.findVisible(id);
  }
}
