import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { NotesRepository } from '../data/notes.repository';
import { ClipboardService } from '@core/services/clipboard/clipboard.service';
import { ErrorNotifier } from '@core/services/errors/error-notifier.service';
import { FALLBACK_LANGUAGE } from '@core/model/language.model';
import { ChecklistItem, Note, NoteDraft, NoteKind, NoteLifecycle, NotePatch } from '../model/note.model';
import { ClockService } from '@core/services/time/clock.service';
import { debounced } from '@core/services/time/debounce';
import { NoteSelectionStore } from './note-selection.store';
import { NotesQueryStore } from './notes-query.store';
import { SpacesStore } from './spaces.store';

export type { NoteFilter, NoteKind } from '../model/note.model';

/** The note is not lost after that: it stays in the trash for 30 days. */
export const UNDO_WINDOW_MS = 8000;

export interface Deletion {
  readonly ids: readonly string[];
  readonly count: number;
}

/**
 * The note being created, **never persisted**: one empty note per opening would turn
 * the canvas into a pile of things to tidy up.
 */
export const DRAFT_ID = '__draft__';

/** A tag, a deadline or an item is enough — a todo list has no body. */
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
 * Empty title and source: the UI renders translated placeholders, and storing "New
 * note" would freeze one language into the data. `txt` means "nothing chosen".
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

/** The draft seen as a `Note`, so the editor need not know two shapes. */
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
    copyText: null,
  };
}

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
 * ⚠️ Exhaustive by construction: a field added to `NoteDraft` stops this table
 * compiling until it says how to compare itself. A patch replaying a value already
 * stored would otherwise write, refreshing `updatedAt` and floating the note up.
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
 * Writable signals stay private — every mutation goes through a method — and **the
 * back end decides**: persist then reload, so there is nothing to roll back.
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

  /**
   * Bumped when the editor is pointed at a **different** note, and at nothing else.
   *
   * ⚠️ The editor's drafts used to key on the note's id, which is right until the one
   * moment it is not: materialising a draft changes that id for the *same* note, so the
   * drafts were replayed from a note that had only just been created — and the body
   * typed a moment earlier was wiped, on screen and then, on close, in the database.
   * Adopting the created note is what this signal deliberately does not react to.
   */
  private readonly _editorSession = signal(0);
  private readonly _lastDeletion = signal<Deletion | null>(null);
  private readonly _undoVisible = signal(false);

  /** The draft wins: while it exists, it is what the editor shows. */
  readonly selectedNote = computed<Note | null>(() => this._draftNote() ?? this._selectedNote());
  readonly selectedNoteId = computed<string | null>(() => this.selectedNote()?.id ?? null);

  /** What the editor's local drafts are keyed on — see [`_editorSession`]. */
  readonly editorSession: Signal<number> = this._editorSession.asReadonly();

  /** The id actually in the database, or `null` while the open note is only a draft. */
  readonly persistedNoteId = computed<string | null>(() => this._selectedNote()?.id ?? null);
  readonly lastDeletion = this._lastDeletion.asReadonly();

  readonly undoBanner = computed<Deletion | null>(() => (this._undoVisible() ? this._lastDeletion() : null));

  private readonly hideUndoBanner = debounced(() => this._undoVisible.set(false), UNDO_WINDOW_MS);

  /**
   * ⚠️ Load-bearing, and it is the **promise** rather than the id it will yield.
   *
   * `requestClose()` fires the title, source and content commits back to back with no
   * change detection and no `await` between them, so the second starts while the first
   * is still writing the row. Holding the id — which only exists once the write comes
   * back — left that whole window answering "still a draft", and a single close then
   * created two notes. Installed before the write leaves, it makes the second commit
   * wait for the first instead of racing it.
   */
  private draftMaterialisation: Promise<string | null> | null = null;

  openNote(id: string): void {
    this.discardDraft();
    this._editorSession.update((session) => session + 1);
    this._selectedNote.set(this.find(id));
    this.selection.focusNote(id);
  }

  /** A draft still empty on close is abandoned, not saved. */
  closeOverlay(): void {
    this.discardDraft();
    this._editorSession.update((session) => session + 1);
    this._selectedNote.set(null);
  }

  /**
   * The single write for a note's own fields. The editor sends what it changed and
   * this drops what has not moved, so closing on an untouched note makes no round
   * trip: nine setters made a new field a four-file change, and wrote the "has it
   * moved?" rule out nine times.
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

  /** The only field storage refuses, when the space is gone. */
  moveNote(id: string, spaceId: string): Promise<void> {
    return this.applyPatch(id, { spaceId });
  }

  /** Replaces the **whole** list: an item has no identity beyond its position. */
  setChecklist(id: string, items: readonly ChecklistItem[]): Promise<void> {
    return this.applyPatch(id, { items });
  }

  /**
   * Opens the editor on a **local draft**: nothing is written until the note is worth
   * keeping. In "all spaces" mode it goes to the first space; with no space at all it
   * is refused, a note without one being invisible under any space filter.
   */
  createNote(kind: NoteKind = 'snippet'): void {
    const spaceId = this.spaceForNewNote();
    if (!spaceId) return;

    this._selectedNote.set(null);
    this.draftMaterialisation = null;
    this._editorSession.update((session) => session + 1);
    this._draftNote.set(emptyNote(spaceId, this.clock.now(), kind));
  }

  /** A note made from the clipboard, triggered by the global shortcut. */
  async captureFromClipboard(): Promise<void> {
    await this.createWithContent(await this.clipboard.paste());
  }

  /** Already carries its content, so no draft: the editor opens on a saved note. */
  async createWithContent(content: string): Promise<void> {
    if (!content.trim()) return;

    const spaceId = this.spaceForNewNote();
    if (!spaceId) return;

    await this.persistNew({ ...emptyDraft(spaceId, 'snippet'), content });
  }

  /** Forces the draft to be saved and returns its real id, `null` if there is none. */
  async materialiseDraft(): Promise<string | null> {
    const persisted = this.persistedNoteId();
    if (persisted) return persisted;

    const draft = this._draftNote();
    if (!draft) return null;

    return this.saveDraft(draft);
  }

  /** Moves to the trash and offers the undo. The note stays there for 30 days. */
  async deleteNote(id: string): Promise<void> {
    const resolved = await this.resolve(id);

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

  /** Same rule as the single writes: the back end decides, we reload. */
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

  /** Hiding the banner **gives up** the undo, unlike the timer running out. */
  dismissUndo(): void {
    this.hideUndoBanner.cancel();
    this._undoVisible.set(false);
    this._lastDeletion.set(null);
  }

  /**
   * ⚠️ Outside `edit()` and `NotePatch`: filling a field is not editing the note, so
   * `updatedAt` stays put and the note does not float to the top of the canvas.
   */
  async setPlaceholderValues(id: string, values: Record<string, string>): Promise<void> {
    const resolved = await this.resolve(id);
    const target = resolved === DRAFT_ID ? await this.materialiseDraft() : resolved;
    if (!target) return;

    const saved = await this.notifier.attempt('errors.noteSaveFailed', () =>
      this.repository.setPlaceholderValues(target, values),
    );
    if (!saved) return;

    if (this.persistedNoteId() === target) {
      this._selectedNote.set(saved);
    }
    this.notes.reload();
  }

  /** The back end is the only judge of what is a field and what is template code. */
  fillPlaceholders(content: string, values: Record<string, string>): Promise<string> {
    return this.repository.fillPlaceholders(content, values);
  }

  private spaceForNewNote(): string | null {
    const spaceId = this.spaces.activeSpaceId() ?? this.spaces.spaces()[0]?.id;
    if (!spaceId) {
      this.notifier.notify({ ref: { key: 'errors.spaceRequired' } });
      return null;
    }

    return spaceId;
  }

  /**
   * Writes the draft and adopts the returned note: `DRAFT_ID` stops existing here.
   *
   * ⚠️ Synchronous down to the assignment, so a second caller arriving before the write
   * comes back joins it rather than starting one of its own.
   */
  private saveDraft(draft: Note): Promise<string | null> {
    this.draftMaterialisation ??= this.writeDraft(draft);

    return this.draftMaterialisation;
  }

  /** A refused write releases the gate: the next commit may still be worth keeping. */
  private async writeDraft(draft: Note): Promise<string | null> {
    const created = await this.persistNew(toDraftPayload(draft));
    if (!created) {
      this.draftMaterialisation = null;
      return null;
    }

    this._draftNote.set(null);

    return created.id;
  }

  private async persistNew(payload: NoteDraft): Promise<Note | null> {
    // ⚠️ Read **before** the write leaves. Materialising a draft takes a round trip, and
    // the editor can be closed inside it — in which case adopting the created note here
    // would put the overlay back on screen, showing a note that carries only the field
    // whose commit started this write. The close then never takes: the dialog the user
    // dismissed is replaced by a new one a moment later.
    const session = this._editorSession();

    const created = await this.notifier.attempt('errors.noteCreateFailed', () =>
      this.repository.create(payload),
    );
    if (!created) return null;

    if (this._editorSession() !== session) return created;

    this._selectedNote.set(created);
    this.selection.focusNote(created.id);
    this.notes.reload();
    return created;
  }

  private discardDraft(): void {
    this._draftNote.set(null);
    this.draftMaterialisation = null;
  }

  private async runOnSelection(action: (ids: readonly string[]) => Promise<number>): Promise<void> {
    const ids = this.selection.checkedNoteIds();
    if (ids.length === 0) return;

    const done = await this.notifier.attempt('errors.bulkActionFailed', () => action(ids));
    if (done !== null) this.notes.reload();
  }

  /**
   * ⚠️ The banner fades, **the deletion stays undoable**: `Ctrl+Z` still works once it
   * is gone, hiding a suggestion not being withdrawing it.
   */
  private openUndoWindow(deletion: Deletion): void {
    this._lastDeletion.set(deletion);
    this._undoVisible.set(true);
    this.hideUndoBanner(undefined);
  }

  /** `changes` answers `null` when nothing moved: a no-op edit makes no round trip. */
  private async edit(id: string, changes: (note: Note) => NotePatch | null): Promise<void> {
    const resolved = await this.resolve(id);
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
   * A write on a draft stays **local** while the note is not worth keeping: changing
   * an empty note's language must not make it appear on the canvas.
   */
  private async editDraft(draft: Note, patch: NotePatch): Promise<void> {
    const updated: Note = { ...draft, ...patch };

    if (!isWorthSaving(updated)) {
      this._draftNote.set(updated);
      return;
    }

    // ⚠️ A write already in flight owns the row, so this patch is an update of it and
    // not a second creation. Joining the write instead would drop the patch on the
    // floor: it carries the argument of the *first* call, not this one.
    if (this.draftMaterialisation) {
      const id = await this.draftMaterialisation;

      return id ? this.persist(id, patch) : undefined;
    }

    await this.saveDraft(updated);
  }

  /**
   * `DRAFT_ID` names the draft **or** the note it became: the editor chains several
   * commits with no change detection in between, and keeps sending the old id.
   *
   * ⚠️ Asynchronous on purpose — see [`draftMaterialisation`]. Awaiting a write already
   * in flight is what turns the second commit into an update of the row the first one
   * created, instead of a second row.
   */
  private async resolve(id: string): Promise<string> {
    if (id !== DRAFT_ID || !this.draftMaterialisation) return id;

    return (await this.draftMaterialisation) ?? DRAFT_ID;
  }

  /**
   * The returned note decides: it carries what the back end actually wrote. `NotePatch`
   * and not `Partial<Note>`, which would let `id` or `createdAt` reach the repository.
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
   * The open note is consulted first: it may have left the filtered view since it was
   * opened without ceasing to be editable.
   */
  private find(id: string): Note | null {
    const draft = this._draftNote();
    if (draft?.id === id) return draft;

    const selected = this._selectedNote();
    if (selected?.id === id) return selected;

    return this.notes.findVisible(id);
  }
}
