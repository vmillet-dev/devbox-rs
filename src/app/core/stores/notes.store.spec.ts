import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { IpcError } from '@core/ipc/ipc.service';
import { Note } from '@core/models/note.model';
import { NotesView } from '@core/models/notes-query.model';
import { Space } from '@core/models/space.model';
import { SpacesStore } from '@core/stores/spaces.store';
import { ClockService } from '@core/time/clock.service';
import { FakeNotesRepository } from '@testing/fake-notes-repository';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { NotesStore, SEARCH_DEBOUNCE_MS } from './notes.store';

/**
 * Filtering, grouping and tag normalisation are the backend's job now and are
 * tested in `src-tauri/src/storage/`. What is left here is what the front still
 * owns: assembling the query, pacing it, adopting what comes back, and
 * surviving a failure.
 */

/** `space-1` is the space the note fixture belongs to. */
const SPACES: readonly Space[] = [
  { id: 'space-1', name: 'Space one' },
  { id: 'space-2', name: 'Space two' },
];

interface Harness {
  readonly store: NotesStore;
  readonly repository: FakeNotesRepository;
  readonly spaces: SpacesStore;
}

async function createStore(notes: Note[] = [], spaces: readonly Space[] = SPACES): Promise<Harness> {
  const repository = new FakeNotesRepository(notes);
  TestBed.configureTestingModule({
    providers: [provideAppTesting({ notesRepository: repository, spaces })],
  });

  const store = TestBed.inject(NotesStore);
  const spacesStore = TestBed.inject(SpacesStore);
  await vi.waitFor(() => expect(store.isLoading()).toBe(false));
  await vi.waitFor(() => expect(spacesStore.spaces()).toHaveLength(spaces.length));

  return { store, repository, spaces: spacesStore };
}

/** Notes as the store currently displays them, across every section. */
function visibleIds(store: NotesStore): string[] {
  return store.sections().flatMap((section) => section.notes.map((note) => note.id));
}

/** Waits for the repository to have been asked a further question. */
async function awaitQuery(repository: FakeNotesRepository, previous: number): Promise<void> {
  await vi.waitFor(() => expect(repository.queryCount).toBeGreaterThan(previous));
}

describe('NotesStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    // The store reports mutation failures through console.error on purpose;
    // silence it so a deliberately failing test doesn't look like a crash.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('shows the view the backend returned', async () => {
    const { store } = await createStore([createNote({ id: 'a' }), createNote({ id: 'b' })]);

    expect(visibleIds(store)).toEqual(['a', 'b']);
  });

  describe('query parameters', () => {
    it('sends no space while all spaces are shown', async () => {
      const { repository } = await createStore([createNote()]);

      // null is a deliberate choice ("every space"), not a missing value.
      expect(repository.lastQuery?.spaceId).toBeNull();
    });

    it('sends the active space once one is selected', async () => {
      const { repository, spaces } = await createStore([createNote()]);
      const before = repository.queryCount;

      spaces.selectSpace('space-2');
      await awaitQuery(repository, before);

      expect(repository.lastQuery?.spaceId).toBe('space-2');
    });

    it('sends the active quick filter', async () => {
      const { store, repository } = await createStore([createNote()]);
      const before = repository.queryCount;

      store.setFilter('untriaged');
      await awaitQuery(repository, before);

      expect(repository.lastQuery?.filter).toBe('untriaged');
    });

    it('sends the selected tags', async () => {
      const { store, repository } = await createStore([createNote()]);
      const before = repository.queryCount;

      store.toggleTag('urgent');
      await awaitQuery(repository, before);

      expect(repository.lastQuery?.tags).toEqual(['urgent']);
    });

    it('drops a tag that is toggled twice', async () => {
      const { store, repository } = await createStore([createNote()]);

      const beforeAdd = repository.queryCount;
      store.toggleTag('urgent');
      await awaitQuery(repository, beforeAdd);
      expect(repository.lastQuery?.tags).toEqual(['urgent']);

      // Each toggle is awaited: selecting then deselecting inside a single tick
      // leaves the criteria untouched, and the store rightly asks nothing.
      const beforeRemove = repository.queryCount;
      store.toggleTag('urgent');
      await awaitQuery(repository, beforeRemove);

      expect(repository.lastQuery?.tags).toEqual([]);
    });

    it('sends the selected languages', async () => {
      const { store, repository } = await createStore([createNote()]);
      const before = repository.queryCount;

      // This is the test that catches a `sameQueryParams` missing its languages
      // clause: the resource would compare the params equal and never refetch.
      store.toggleLanguage('json');
      await awaitQuery(repository, before);

      expect(repository.lastQuery?.languages).toEqual(['json']);
    });

    it('drops a language that is toggled twice', async () => {
      const { store, repository } = await createStore([createNote()]);

      const beforeAdd = repository.queryCount;
      store.toggleLanguage('json');
      await awaitQuery(repository, beforeAdd);
      expect(repository.lastQuery?.languages).toEqual(['json']);

      const beforeRemove = repository.queryCount;
      store.toggleLanguage('json');
      await awaitQuery(repository, beforeRemove);

      expect(repository.lastQuery?.languages).toEqual([]);
    });

    it('sends the timezone offset, without which sections straddle local midnight', async () => {
      const { repository } = await createStore([createNote()]);

      expect(repository.lastQuery?.tzOffsetMinutes).toBe(repository.lastQuery?.now.getTimezoneOffset());
    });

    it('sends the raw tag as typed, leaving normalisation to the backend', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', tags: [] })]);
      const update = vi.spyOn(repository, 'update');

      await store.addTag('a', '  #urgent ');

      // Trimming here would mean two places deciding what a tag looks like.
      expect(update).toHaveBeenCalledWith('a', { tags: ['  #urgent '] });
    });
  });

  /**
   * `queryParams` builds a fresh object literal and reads `clock.now()`, while
   * `resource` compares its parameters by identity. Only the `equal` comparator
   * keeps a clock tick from firing a full IPC round trip — and the retained view
   * would hide it, so nothing else would notice.
   */
  describe('clock sensitivity', () => {
    async function createStoreWithClock(now: WritableSignal<Date>): Promise<Harness> {
      const repository = new FakeNotesRepository([createNote()]);
      TestBed.configureTestingModule({
        providers: [
          provideAppTesting({ notesRepository: repository, spaces: SPACES }),
          { provide: ClockService, useValue: { now: now.asReadonly() } },
        ],
      });

      const store = TestBed.inject(NotesStore);
      await vi.waitFor(() => expect(store.isLoading()).toBe(false));

      return { store, repository, spaces: TestBed.inject(SpacesStore) };
    }

    it('does not re-query when the clock ticks inside the same local day', async () => {
      const now = signal(new Date(2026, 6, 25, 12, 0, 0));
      const { repository } = await createStoreWithClock(now);
      const before = repository.queryCount;

      now.set(new Date(2026, 6, 25, 12, 0, 30));
      now.set(new Date(2026, 6, 25, 23, 59, 59));
      // Give the resource's load effect every chance to fire.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(repository.queryCount).toBe(before);
    });

    it('re-queries when the local day changes, or sections would stay on yesterday', async () => {
      const now = signal(new Date(2026, 6, 25, 23, 59, 59));
      const { repository } = await createStoreWithClock(now);
      const before = repository.queryCount;

      now.set(new Date(2026, 6, 26, 0, 0, 1));

      await awaitQuery(repository, before);
    });
  });

  describe('search debounce', () => {
    beforeEach(() => {
      // Only Date and timers: faking requestAnimationFrame would hang the
      // zoneless scheduler in whenStable().
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    it('updates the field immediately so typing never lags', async () => {
      const { store } = await createStore([createNote()]);

      store.setSearchQuery('dep');

      expect(store.searchQuery()).toBe('dep');
    });

    it('does not query the backend before the debounce elapses', async () => {
      const { store, repository } = await createStore([createNote()]);
      const before = repository.queryCount;

      store.setSearchQuery('dep');

      expect(repository.queryCount).toBe(before);
    });

    it('sends a single query for a burst of keystrokes', async () => {
      const { store, repository } = await createStore([createNote()]);
      const before = repository.queryCount;

      store.setSearchQuery('d');
      store.setSearchQuery('de');
      store.setSearchQuery('dep');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await vi.waitFor(() => expect(repository.queryCount).toBe(before + 1));

      // One round trip per character is exactly what the debounce exists to avoid.
      expect(repository.lastQuery?.search).toBe('dep');
    });

    it('trims the query it sends', async () => {
      const { store, repository } = await createStore([createNote()]);
      const before = repository.queryCount;

      store.setSearchQuery('  dep  ');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await awaitQuery(repository, before);

      expect(repository.lastQuery?.search).toBe('dep');
    });
  });

  describe('loading and error state', () => {
    it('exposes the repository failure and shows nothing', async () => {
      const repository = new FakeNotesRepository([createNote()]);
      repository.failNext = new Error('backend down');
      TestBed.configureTestingModule({
        providers: [provideAppTesting({ notesRepository: repository })],
      });

      const store = TestBed.inject(NotesStore);
      await vi.waitFor(() => expect(store.loadError()).toBeDefined());

      expect(store.loadError()?.message).toBe('backend down');
      expect(store.sections()).toEqual([]);
    });

    it('recovers the view on reload after a failed load', async () => {
      const repository = new FakeNotesRepository([createNote({ id: 'recovered' })]);
      repository.failNext = new Error('transient');
      TestBed.configureTestingModule({
        providers: [provideAppTesting({ notesRepository: repository })],
      });

      const store = TestBed.inject(NotesStore);
      await vi.waitFor(() => expect(store.loadError()).toBeDefined());

      store.reload();
      await vi.waitFor(() => expect(visibleIds(store)).toHaveLength(1));

      expect(store.loadError()).toBeUndefined();
      expect(visibleIds(store)).toEqual(['recovered']);
    });

    it('keeps the previous results on screen while a new query runs', async () => {
      // Blanking the canvas on every debounced keystroke would make the list
      // flicker between "Loading…" and the results.
      const { store, spaces } = await createStore([createNote({ id: 'a' })]);

      spaces.selectSpace('space-2');

      expect(store.isLoading()).toBe(false);
      expect(visibleIds(store)).toEqual(['a']);
    });
  });

  describe('view-derived state', () => {
    it('reports no results only when a search is actually active', async () => {
      const { store, repository } = await createStore([]);
      const before = repository.queryCount;
      repository.setView({ isFiltering: true, matched: 0, sections: [] });

      store.setFilter('pinned');
      await awaitQuery(repository, before);

      expect(store.hasNoResults()).toBe(true);
    });

    it('does not report "no results" for an empty space', async () => {
      const { store } = await createStore([]);

      // An empty space and a fruitless search read very differently to a user.
      expect(store.isFiltering()).toBe(false);
      expect(store.hasNoResults()).toBe(false);
    });

    it('exposes the tags the backend offers for the rail', async () => {
      const { store } = await createStore([
        createNote({ id: 'a', tags: ['zeta', 'alpha'] }),
        createNote({ id: 'b', tags: ['alpha'] }),
      ]);

      expect(store.allTags()).toEqual(['alpha', 'zeta']);
    });

    it('exposes the languages the backend offers for the rail', async () => {
      const { store } = await createStore([
        createNote({ id: 'a', language: 'yml' }),
        createNote({ id: 'b', language: 'json' }),
        createNote({ id: 'c', language: 'json' }),
      ]);

      expect(store.allLanguages()).toEqual(['json', 'yml']);
    });
  });

  describe('selection', () => {
    it('exposes the selected note and clears it on close', async () => {
      const note = createNote({ id: 'selected' });
      const { store } = await createStore([note]);

      store.openNote('selected');
      expect(store.selectedNote()).toEqual(note);

      store.closeOverlay();
      expect(store.selectedNote()).toBeNull();
    });

    it('returns null when the selected id does not match any note', async () => {
      const { store } = await createStore([createNote({ id: 'a' })]);

      store.openNote('does-not-exist');

      expect(store.selectedNote()).toBeNull();
    });

    it('keeps the open note editable after it drops out of the filtered view', async () => {
      // Removing a note's last matching tag must not yank the editor shut.
      const { store, repository } = await createStore([createNote({ id: 'a', tags: ['urgent'] })]);
      store.openNote('a');
      const before = repository.queryCount;

      repository.setView({ sections: [], matched: 0, isFiltering: true });
      store.toggleTag('other');
      await awaitQuery(repository, before);

      expect(visibleIds(store)).toEqual([]);
      expect(store.selectedNoteId()).toBe('a');
    });
  });

  describe('mutations', () => {
    it('persists a pin toggle and adopts the stored note', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', pinned: false })]);
      const update = vi.spyOn(repository, 'update');
      store.openNote('a');

      await store.togglePinned('a');

      expect(update).toHaveBeenCalledWith('a', { pinned: true });
      expect(store.selectedNote()?.pinned).toBe(true);
    });

    it('re-queries the backend after a successful write', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', title: 'Old' })]);
      const before = repository.queryCount;

      await store.renameNote('a', 'New');
      await awaitQuery(repository, before);

      // The view is the backend's to compute: a write can move a note between
      // sections, so it has to be recomputed rather than patched locally.
      expect(repository.queryCount).toBeGreaterThan(before);
    });

    it('skips persistence when the value has not changed', async () => {
      // The overlay emits on every keystroke; an unchanged value must not
      // produce a write per character.
      const { store, repository } = await createStore([createNote({ id: 'a', title: 'Same' })]);
      const update = vi.spyOn(repository, 'update');

      await store.renameNote('a', 'Same');
      await store.updateContent('a', 'line one\nline two');
      await store.setLanguage('a', 'txt');

      expect(update).not.toHaveBeenCalled();
    });

    it('notifies and leaves the view alone when a write fails', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', title: 'Original' })]);
      const notifier = TestBed.inject(ErrorNotifier);
      repository.failNext = new Error('disk full');

      await store.renameNote('a', 'Attempted');

      // Nothing was applied locally in the first place, so there is nothing to
      // roll back — the displayed note is still the stored one.
      expect(visibleIds(store)).toEqual(['a']);
      expect(store.sections()[0].notes[0].title).toBe('Original');
      expect(notifier.notice()?.ref.key).toBe('errors.noteSaveFailed');
    });

    it('does nothing for an unknown id', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a' })]);
      const update = vi.spyOn(repository, 'update');
      const remove = vi.spyOn(repository, 'delete');

      await store.togglePinned('missing');
      await store.deleteNote('missing');

      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });

    it('removes a tag the note carries', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', tags: ['keep', 'drop'] })]);
      const update = vi.spyOn(repository, 'update');

      await store.removeTag('a', 'drop');

      expect(update).toHaveBeenCalledWith('a', { tags: ['keep'] });
    });

    it('does nothing when removing a tag the note does not carry', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', tags: ['keep'] })]);
      const update = vi.spyOn(repository, 'update');

      await store.removeTag('a', 'absent');

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('moveNote', () => {
    it('files the note in another space', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', spaceId: 'space-1' })]);
      const update = vi.spyOn(repository, 'update');

      await store.moveNote('a', 'space-2');

      expect(update).toHaveBeenCalledWith('a', { spaceId: 'space-2' });
    });

    it('does not write when the note is already in that space', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', spaceId: 'space-1' })]);
      const update = vi.spyOn(repository, 'update');

      await store.moveNote('a', 'space-1');

      expect(update).not.toHaveBeenCalled();
    });

    it('reports a space that no longer exists', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', spaceId: 'space-1' })]);
      const notifier = TestBed.inject(ErrorNotifier);
      repository.failNext = new IpcError('update_note', {
        code: 'spaceNotFound',
        params: { id: 'space-2' },
        detail: 'Espace introuvable : space-2',
      });

      await store.moveNote('a', 'space-2');

      // Naming the cause beats "could not save": the space was deleted in
      // another window while this menu was open.
      expect(notifier.notice()?.ref.key).toBe('errors.spaceGone');
    });
  });

  describe('setLifecycle', () => {
    it('turns a permanent note into an expiring one', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a' })]);
      const update = vi.spyOn(repository, 'update');
      const at = new Date('2026-08-01T23:59:59.999Z');

      await store.setLifecycle('a', { kind: 'expires', at });

      // This write is the only thing that feeds the "À trier" filter: without
      // it the chip and the lifecycle badge have nothing to show.
      expect(update).toHaveBeenCalledWith('a', { lifecycle: { kind: 'expires', at } });
    });

    it('clears an expiry back to permanent', async () => {
      const { store, repository } = await createStore([
        createNote({ id: 'a', lifecycle: { kind: 'expires', at: new Date('2026-08-01T00:00:00Z') } }),
      ]);
      const update = vi.spyOn(repository, 'update');

      await store.setLifecycle('a', { kind: 'permanent' });

      expect(update).toHaveBeenCalledWith('a', { lifecycle: { kind: 'permanent' } });
    });

    it('does not write when the deadline is unchanged', async () => {
      const at = new Date('2026-08-01T00:00:00Z');
      const { store, repository } = await createStore([
        createNote({ id: 'a', lifecycle: { kind: 'expires', at } }),
      ]);
      const update = vi.spyOn(repository, 'update');

      // A fresh `Date` carrying the same instant: comparing by identity would
      // write on every visit to the date field.
      await store.setLifecycle('a', { kind: 'expires', at: new Date(at.getTime()) });

      expect(update).not.toHaveBeenCalled();
    });

    it('writes when only the deadline moves', async () => {
      const { store, repository } = await createStore([
        createNote({ id: 'a', lifecycle: { kind: 'expires', at: new Date('2026-08-01T00:00:00Z') } }),
      ]);
      const update = vi.spyOn(repository, 'update');

      await store.setLifecycle('a', { kind: 'expires', at: new Date('2026-09-01T00:00:00Z') });

      expect(update).toHaveBeenCalled();
    });
  });

  describe('createNote', () => {
    it('opens the note returned by the repository', async () => {
      const { store } = await createStore([createNote({ id: 'existing' })]);

      await store.createNote();

      // Blank title and source: the UI renders translated placeholders rather
      // than storing French strings in the data.
      expect(store.selectedNote()).toMatchObject({
        id: 'fake-1',
        title: '',
        source: '',
        content: '',
        pinned: false,
        tags: [],
      });
    });

    it('takes its id from the repository rather than generating one locally', async () => {
      const { store } = await createStore([]);

      await store.createNote();

      expect(store.selectedNoteId()).toBe('fake-1');
    });

    it('files the note in the selected space', async () => {
      const { store, spaces } = await createStore([]);

      spaces.selectSpace('space-2');
      await store.createNote();

      expect(store.selectedNote()?.spaceId).toBe('space-2');
    });

    it('files the note in the first space while showing all spaces', async () => {
      // It has to land somewhere, and the first space is the one the switcher
      // shows at the top of the list.
      const { store } = await createStore([]);

      await store.createNote();

      expect(store.selectedNote()?.spaceId).toBe('space-1');
    });

    it('refuses to create a note when no space exists at all', async () => {
      // A note without a space would vanish as soon as a space filter is applied.
      const { store, repository } = await createStore([], []);
      const notifier = TestBed.inject(ErrorNotifier);
      const create = vi.spyOn(repository, 'create');

      await store.createNote();

      expect(create).not.toHaveBeenCalled();
      expect(notifier.notice()?.ref.key).toBe('errors.spaceRequired');
    });

    it('notifies and selects nothing when creation fails', async () => {
      const { store, repository } = await createStore([]);
      const notifier = TestBed.inject(ErrorNotifier);
      repository.failNext = new Error('read-only');

      await store.createNote();

      expect(store.selectedNote()).toBeNull();
      expect(notifier.notice()?.ref.key).toBe('errors.noteCreateFailed');
    });
  });

  describe('deleteNote', () => {
    it('closes the overlay when the deleted note was the open one', async () => {
      const { store } = await createStore([createNote({ id: 'a' }), createNote({ id: 'b' })]);
      store.openNote('a');

      await store.deleteNote('a');

      expect(store.selectedNoteId()).toBeNull();
      await vi.waitFor(() => expect(visibleIds(store)).toEqual(['b']));
    });

    it('leaves the open note alone when another one is deleted', async () => {
      const { store } = await createStore([createNote({ id: 'a' }), createNote({ id: 'b' })]);
      store.openNote('a');

      await store.deleteNote('b');

      expect(store.selectedNoteId()).toBe('a');
    });

    it('keeps the note and notifies when deletion fails', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a' })]);
      const notifier = TestBed.inject(ErrorNotifier);
      repository.failNext = new Error('locked');
      store.openNote('a');

      await store.deleteNote('a');

      expect(visibleIds(store)).toEqual(['a']);
      expect(store.selectedNoteId()).toBe('a');
      expect(notifier.notice()?.ref.key).toBe('errors.noteDeleteFailed');
    });
  });

  describe('backend-shaped view', () => {
    it('renders whatever sections the backend sends, in order', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a' })]);
      const before = repository.queryCount;
      const view: Partial<NotesView> = {
        sections: [
          { key: 'pinned', notes: [], hasExpiringNotes: false, showCreateGhost: false },
          { key: 'today', notes: [], hasExpiringNotes: true, showCreateGhost: false },
          { key: 'week', notes: [], hasExpiringNotes: false, showCreateGhost: true },
        ],
      };
      repository.setView(view);

      store.setFilter('pinned');
      await awaitQuery(repository, before);

      // The store must not re-sort, re-group or drop empty sections.
      expect(store.sections().map((section) => section.key)).toEqual(['pinned', 'today', 'week']);
    });
  });
});
