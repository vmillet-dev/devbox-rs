import {
  Injectable,
  Signal,
  computed,
  inject,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { NotesRepository } from '../data/notes.repository';
import { ClipboardService } from '@core/clipboard/clipboard.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FALLBACK_LANGUAGE, LanguageTag } from '@core/language/language.model';
import {
  ChecklistItem,
  Note,
  NoteDraft,
  NoteFilter,
  NoteKind,
  NoteLifecycle,
  NotePatch,
  NoteSection,
  NotesQuery,
  NotesView,
} from '../model/note.model';
import { ClockService } from '@core/time/clock.service';
import { NotesRevision } from './notes-revision';
import { SEARCH_DEBOUNCE_MS, debounced } from '@core/time/debounce';
import { SpacesStore } from './spaces.store';

export type { NoteFilter, NoteKind } from '../model/note.model';

// Re-exported so the search delay and the store that uses it stay one import
// away from each other.
export { SEARCH_DEBOUNCE_MS };

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

function sameItems(a: readonly ChecklistItem[], b: readonly ChecklistItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => item.text === b[index]?.text && item.done === b[index]?.done)
  );
}

/** The **local** day: a new query only on a day change. */
function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

interface QueryParams {
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  readonly languages: readonly LanguageTag[];
  readonly day: string;
  /** Bumped by whoever wrote notes from outside this store. */
  readonly revision: number;
}

function sameFacets(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * By **value**: `Date` compares by identity, so replaying the same deadline
 * would trigger a write on every pass through the date field.
 */
function sameLifecycle(a: NoteLifecycle, b: NoteLifecycle): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'expires' || a.at.getTime() === (b as { at: Date }).at.getTime();
}

/** A fresh set, never mutated. */
function toggled<T>(selection: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(selection);
  if (!next.delete(value)) {
    next.add(value);
  }
  return next;
}

/**
 * ⚠️ `resource` compares its params by identity: without this comparator, the
 * fresh literal `queryParams` builds on every clock tick would fire a full
 * query every 30 s, hidden behind the retained view.
 */
function sameQueryParams(a: QueryParams, b: QueryParams): boolean {
  return (
    a.spaceId === b.spaceId &&
    a.search === b.search &&
    a.filter === b.filter &&
    a.day === b.day &&
    a.revision === b.revision &&
    sameFacets(a.tags, b.tags) &&
    sameFacets(a.languages, b.languages)
  );
}

/**
 * Notes state. Does not filter, sort or group: it describes what the user asks
 * for and displays the **view** the back end returns.
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
  private readonly revision = inject(NotesRevision);

  private readonly _searchQuery = signal('');
  private readonly _debouncedSearch = signal('');
  private readonly _activeFilter = signal<NoteFilter>('all');
  private readonly _selectedTags = signal<ReadonlySet<string>>(new Set());
  private readonly _selectedLanguages = signal<ReadonlySet<LanguageTag>>(new Set());
  private readonly _selectedNote = signal<Note | null>(null);
  private readonly _draftNote = signal<Note | null>(null);
  private readonly _checkedIds = signal<ReadonlySet<string>>(new Set());
  private readonly _focusedNoteId = signal<string | null>(null);
  private readonly _lastDeletion = signal<Deletion | null>(null);
  private readonly _undoVisible = signal(false);

  /** Follows the typing without waiting: this is what the field shows. */
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();
  readonly selectedTags = this._selectedTags.asReadonly();
  readonly selectedLanguages = this._selectedLanguages.asReadonly();
  /** The draft wins: while it exists, it is what the editor shows. */
  readonly selectedNote = computed<Note | null>(() => this._draftNote() ?? this._selectedNote());
  readonly selectedNoteId = computed<string | null>(() => this.selectedNote()?.id ?? null);

  /**
   * The id actually in the database, or `null` while the open note is only a
   * draft. What anything needing a real row must read — attachments, say.
   */
  readonly persistedNoteId = computed<string | null>(() => this._selectedNote()?.id ?? null);
  readonly focusedNoteId = this._focusedNoteId.asReadonly();
  readonly checkedIds = this._checkedIds.asReadonly();
  readonly lastDeletion = this._lastDeletion.asReadonly();

  /** What the banner shows: the same deletion, while it is still offered. */
  readonly undoBanner = computed<Deletion | null>(() => (this._undoVisible() ? this._lastDeletion() : null));

  private readonly commitSearch = debounced(
    (query: string) => this._debouncedSearch.set(query),
    SEARCH_DEBOUNCE_MS,
  );

  private readonly hideUndoBanner = debounced(() => this._undoVisible.set(false), UNDO_WINDOW_MS);

  /**
   * The real id the draft took once saved.
   *
   * ⚠️ Load-bearing: closing the editor commits the title **then** the content
   * with no change detection in between, so the second call still carries
   * `DRAFT_ID` while the note already exists.
   */
  private draftMaterialisedAs: string | null = null;

  /**
   * What triggers a query. The exact instant is not part of it: only the **day**
   * matters for the section split. The `equal` comparator is load-bearing, see
   * `sameQueryParams`.
   */
  private readonly queryParams = computed<QueryParams>(
    () => ({
      spaceId: this.spaces.activeSpaceId(),
      search: this._debouncedSearch().trim(),
      filter: this._activeFilter(),
      tags: [...this._selectedTags()].sort(),
      languages: [...this._selectedLanguages()].sort(),
      day: localDayKey(this.clock.now()),
      revision: this.revision.current(),
    }),
    { equal: sameQueryParams },
  );

  private readonly viewResource = resource({
    params: () => this.queryParams(),
    loader: ({ params }): Promise<NotesView> => {
      // Deliberately untracked: we want the current instant without the query
      // re-running on every tick (see `queryParams`).
      const now = untracked(() => this.clock.now());
      const query: NotesQuery = {
        spaceId: params.spaceId,
        search: params.search,
        filter: params.filter,
        tags: params.tags,
        languages: params.languages,
        now,
        tzOffsetMinutes: now.getTimezoneOffset(),
        // Always true on the canvas: pinning is what keeps a note within reach
        // there, and what makes the top section.
        pinnedFirst: true,
      };
      return this.repository.query(query);
    },
  });

  /**
   * The last view obtained, kept during reloads: without it every keystroke
   * would blank the canvas.
   *
   * ⚠️ A `linkedSignal` only retains what it has **seen go past**, its value
   * being recomputed on read. Everything this store exposes therefore reads
   * `view()`, with no short-circuit (see `isLoading`).
   */
  private readonly view = linkedSignal<NotesView | undefined, NotesView | null>({
    source: () => (this.viewResource.hasValue() ? this.viewResource.value() : undefined),
    computation: (fresh, previous) => fresh ?? previous?.value ?? null,
  });

  readonly sections = computed<readonly NoteSection[]>(() => this.view()?.sections ?? []);
  readonly allTags = computed<readonly string[]>(() => this.view()?.availableTags ?? []);
  readonly allLanguages = computed<readonly LanguageTag[]>(() => this.view()?.availableLanguages ?? []);
  readonly isFiltering = computed(() => this.view()?.isFiltering ?? false);

  /** A search is running but found nothing: the UI has to say so. */
  readonly hasNoResults = computed(() => {
    const view = this.view();
    return view !== null && view.isFiltering && view.matched === 0;
  });

  /**
   * True only while no view has ever been obtained.
   *
   * ⚠️ `view()` is read **before** the resource state: an `&&` the other way
   * round would short-circuit past the read once loading finishes, and the
   * freshly loaded view would never be retained.
   */
  readonly isLoading = computed(() => {
    const hasView = this.view() !== null;
    return !hasView && this.viewResource.isLoading();
  });

  readonly loadError: Signal<Error | undefined> = this.viewResource.error;

  /**
   * The displayed notes, flat and **in section order**: what keyboard
   * navigation follows, and what a range selection spans.
   */
  readonly visibleNotes = computed<readonly Note[]>(() =>
    this.sections().flatMap((section) => [...section.notes]),
  );

  /**
   * Derived from what is visible, never read raw: an id ticked then gone (note
   * deleted, filter narrowed) must not travel into a bulk action.
   */
  readonly checkedNotes = computed<readonly Note[]>(() => {
    const checked = this._checkedIds();
    return this.visibleNotes().filter((note) => checked.has(note.id));
  });

  readonly checkedCount = computed(() => this.checkedNotes().length);
  readonly hasSelection = computed(() => this.checkedCount() > 0);

  reload(): void {
    this.viewResource.reload();
  }

  /** Updates the field at once, defers the query. */
  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
    this.commitSearch(query);
  }

  setFilter(filter: NoteFilter): void {
    this._activeFilter.set(filter);
  }

  toggleTag(tag: string): void {
    this._selectedTags.update((tags) => toggled(tags, tag));
  }

  toggleLanguage(language: LanguageTag): void {
    this._selectedLanguages.update((languages) => toggled(languages, language));
  }

  openNote(id: string): void {
    this.discardDraft();
    this._selectedNote.set(this.find(id));
    this._focusedNoteId.set(id);
  }

  /** A draft still empty on close is abandoned, not saved. */
  closeOverlay(): void {
    this.discardDraft();
    this._selectedNote.set(null);
  }

  // --- Keyboard navigation ---------------------------------------------------

  /** `null` takes focus off the canvas — when a modal opens, for instance. */
  focusNote(id: string | null): void {
    this._focusedNoteId.set(id);
  }

  /** Index of the focused note in [`visibleNotes`], or `-1`. */
  focusedIndex(): number {
    const focused = this._focusedNoteId();
    return focused === null ? -1 : this.visibleNotes().findIndex((note) => note.id === focused);
  }

  /**
   * Focuses by position rather than by id: navigation reasons in indices, the
   * only landmark that survives a renamed note.
   */
  focusIndex(index: number): void {
    const note = this.visibleNotes()[index];
    if (note) {
      this._focusedNoteId.set(note.id);
    }
  }

  // --- Multiple selection ----------------------------------------------------

  toggleChecked(id: string): void {
    this._checkedIds.update((checked) => toggled(checked, id));
  }

  /**
   * Ticks everything between the focused note and `id` — a file list's
   * Shift+click. With no anchor, this ticks the named note alone.
   */
  checkRangeTo(id: string): void {
    const visible = this.visibleNotes();
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
    const ids = this.checkedNotes().map((note) => note.id);
    if (ids.length === 0) return;

    const count = await this.notifier.attempt('errors.bulkActionFailed', () =>
      this.repository.deleteMany(ids),
    );
    if (count === null) return;

    this.clearSelection();
    this.openUndoWindow({ ids, count });
    this.reload();
  }

  // --- Undoing a deletion ----------------------------------------------------

  async undoDeletion(): Promise<void> {
    const deletion = this._lastDeletion();
    if (!deletion) return;

    this.dismissUndo();
    const restored = await this.notifier.attempt('errors.trashActionFailed', () =>
      this.repository.restore(deletion.ids),
    );
    if (restored !== null) this.reload();
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

  togglePinned(id: string): Promise<void> {
    return this.edit(id, (note) => ({ pinned: !note.pinned }));
  }

  /** The editor also commits an unchanged title on close, hence the `null`. */
  renameNote(id: string, title: string): Promise<void> {
    return this.edit(id, (note) => (note.title === title ? null : { title }));
  }

  updateContent(id: string, content: string): Promise<void> {
    return this.edit(id, (note) => (note.content === content ? null : { content }));
  }

  /**
   * A free-form breadcrumb. It is what makes the card footer's `source` variant
   * reachable, which `notes::model::footer_of` reserves for pinned notes.
   */
  setSource(id: string, source: string): Promise<void> {
    return this.edit(id, (note) => (note.source === source ? null : { source }));
  }

  /**
   * `spaceId` is the only field the front pushes without the user typing it,
   * and the only one storage refuses when the space is gone.
   */
  moveNote(id: string, spaceId: string): Promise<void> {
    return this.edit(id, (note) => (note.spaceId === spaceId ? null : { spaceId }));
  }

  setLanguage(id: string, language: LanguageTag): Promise<void> {
    return this.edit(id, (note) => (note.language === language ? null : { language }));
  }

  /**
   * Replaces the **whole** list — ticking, renaming, adding, removing and
   * reordering all go through here, because no item has an identity of its own:
   * its position is all that designates it.
   *
   * The comparison avoids the pointless write that closing the editor right
   * after a tick would make, floating the note to the top for nothing.
   */
  setChecklist(id: string, items: readonly ChecklistItem[]): Promise<void> {
    return this.edit(id, (note) =>
      sameItems(note.items, items) ? null : { items: items.map((item) => ({ ...item })) },
    );
  }

  /**
   * Sets or clears the deadline. This write, and only this one, feeds the
   * "untriaged" filter and the sections' "due soon" hint.
   */
  setLifecycle(id: string, lifecycle: NoteLifecycle): Promise<void> {
    return this.edit(id, (note) => (sameLifecycle(note.lifecycle, lifecycle) ? null : { lifecycle }));
  }

  /**
   * No normalisation here: trim, leading `#` and duplicates are decided by
   * `notes::model::normalize_tags`, the only place the rule lives.
   */
  addTag(id: string, tag: string): Promise<void> {
    return this.edit(id, (note) => ({ tags: [...note.tags, tag] }));
  }

  removeTag(id: string, tag: string): Promise<void> {
    return this.edit(id, (note) =>
      note.tags.includes(tag) ? { tags: note.tags.filter((existing) => existing !== tag) } : null,
    );
  }

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
    this._focusedNoteId.set(created.id);
    this.reload();
    return created;
  }

  private discardDraft(): void {
    this._draftNote.set(null);
    this.draftMaterialisedAs = null;
  }

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
    this.reload();
  }

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
    this.reload();
  }

  /**
   * Fills a piece of content's `{{fields}}`. The back end is the only judge of
   * what is a field and what is Angular template code.
   */
  fillPlaceholders(content: string, values: Record<string, string>): Promise<string> {
    return this.repository.fillPlaceholders(content, values);
  }

  private async runOnSelection(action: (ids: readonly string[]) => Promise<number>): Promise<void> {
    const ids = this.checkedNotes().map((note) => note.id);
    if (ids.length === 0) return;

    const done = await this.notifier.attempt('errors.bulkActionFailed', () => action(ids));
    if (done !== null) this.reload();
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
    this.reload();
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

    for (const section of this.sections()) {
      const found = section.notes.find((note) => note.id === id);
      if (found) return found;
    }
    return null;
  }
}
