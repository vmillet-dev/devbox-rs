import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { Note } from '@core/models/note.model';
import { Space } from '@core/models/space.model';
import { SpacesStore } from '@core/stores/spaces.store';
import { FakeNotesRepository } from '@testing/fake-notes-repository';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { NotesStore } from './notes.store';

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

/** Creates a `NotesStore` backed by a fake repository and waits for the initial load to settle. */
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

describe('NotesStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    // The store reports mutation failures through console.error on purpose;
    // silence it so a deliberately failing test doesn't look like a crash.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('loads notes from the repository on creation', async () => {
    const { store } = await createStore([createNote({ id: 'a' }), createNote({ id: 'b' })]);

    expect(store.filteredNotes().map((note) => note.id)).toEqual(['a', 'b']);
  });

  describe('loading and error state', () => {
    it('exposes the repository failure and holds an empty list', async () => {
      const repository = new FakeNotesRepository([createNote()]);
      repository.failNext = new Error('backend down');
      TestBed.configureTestingModule({ providers: [provideAppTesting({ notesRepository: repository })] });

      const store = TestBed.inject(NotesStore);
      await vi.waitFor(() => expect(store.loadError()).toBeDefined());

      expect(store.loadError()?.message).toBe('backend down');
      expect(store.filteredNotes()).toEqual([]);
    });

    it('recovers the notes on reload after a failed load', async () => {
      const note = createNote({ id: 'recovered' });
      const repository = new FakeNotesRepository([note]);
      repository.failNext = new Error('transient');
      TestBed.configureTestingModule({ providers: [provideAppTesting({ notesRepository: repository })] });

      const store = TestBed.inject(NotesStore);
      await vi.waitFor(() => expect(store.loadError()).toBeDefined());

      store.reload();
      await vi.waitFor(() => expect(store.filteredNotes()).toHaveLength(1));

      expect(store.loadError()).toBeUndefined();
      expect(store.filteredNotes()[0].id).toBe('recovered');
    });
  });

  describe('allTags', () => {
    it('returns the sorted, de-duplicated set of tags across all notes', async () => {
      const { store } = await createStore([
        createNote({ id: 'a', tags: ['zeta', 'alpha'] }),
        createNote({ id: 'b', tags: ['alpha', 'beta'] }),
      ]);

      expect(store.allTags()).toEqual(['alpha', 'beta', 'zeta']);
    });
  });

  describe('filteredNotes', () => {
    it('matches the search query against the title, tags and content, case-insensitively', async () => {
      const target = createNote({ id: 'match', title: 'Deploy script', content: 'irrelevant', tags: [] });
      const other = createNote({ id: 'other', title: 'Something else', content: 'irrelevant', tags: [] });
      const { store } = await createStore([target, other]);

      store.setSearchQuery('DEPLOY');

      expect(store.filteredNotes()).toEqual([target]);
    });

    it('keeps only pinned notes when the "pinned" filter is active', async () => {
      const pinned = createNote({ id: 'pinned', pinned: true });
      const unpinned = createNote({ id: 'unpinned', pinned: false });
      const { store } = await createStore([pinned, unpinned]);

      store.setFilter('pinned');

      expect(store.filteredNotes()).toEqual([pinned]);
    });

    it('keeps only expiring notes when the "untriaged" filter is active', async () => {
      const expiring = createNote({
        id: 'expiring',
        lifecycle: { kind: 'expires', at: new Date('2026-02-01') },
      });
      const permanent = createNote({ id: 'permanent', lifecycle: { kind: 'permanent' } });
      const { store } = await createStore([expiring, permanent]);

      store.setFilter('untriaged');

      expect(store.filteredNotes()).toEqual([expiring]);
    });

    it('keeps only notes matching at least one selected tag', async () => {
      const matching = createNote({ id: 'matching', tags: ['urgent'] });
      const other = createNote({ id: 'other', tags: ['later'] });
      const { store } = await createStore([matching, other]);

      store.toggleTag('urgent');

      expect(store.filteredNotes()).toEqual([matching]);
    });

    it('un-selects a tag when toggled twice', async () => {
      const notes = [createNote({ id: 'a', tags: ['urgent'] }), createNote({ id: 'b', tags: ['later'] })];
      const { store } = await createStore(notes);

      store.toggleTag('urgent');
      store.toggleTag('urgent');

      expect(store.filteredNotes()).toEqual(notes);
    });

    it('combines search, filter and tag criteria', async () => {
      const target = createNote({ id: 'target', title: 'Deploy notes', pinned: true, tags: ['urgent'] });
      const wrongTag = createNote({ id: 'wrong-tag', title: 'Deploy notes', pinned: true, tags: ['later'] });
      const notPinned = createNote({
        id: 'not-pinned',
        title: 'Deploy notes',
        pinned: false,
        tags: ['urgent'],
      });
      const { store } = await createStore([target, wrongTag, notPinned]);

      store.setSearchQuery('deploy');
      store.setFilter('pinned');
      store.toggleTag('urgent');

      expect(store.filteredNotes()).toEqual([target]);
    });
  });

  describe('active space', () => {
    const notesAcrossSpaces = (): Note[] => [
      createNote({ id: 'here', spaceId: 'space-1', tags: ['here-tag'] }),
      createNote({ id: 'elsewhere', spaceId: 'space-2', tags: ['elsewhere-tag'] }),
    ];

    it('shows every note while no space is selected', async () => {
      const { store } = await createStore(notesAcrossSpaces());

      expect(store.filteredNotes().map((note) => note.id)).toEqual(['here', 'elsewhere']);
    });

    it('keeps only the notes of the selected space', async () => {
      const { store, spaces } = await createStore(notesAcrossSpaces());

      spaces.selectSpace('space-2');

      expect(store.filteredNotes().map((note) => note.id)).toEqual(['elsewhere']);
    });

    it('scopes the tag rail to the selected space', async () => {
      // A tag that filters nothing in the current space has no reason to be offered.
      const { store, spaces } = await createStore(notesAcrossSpaces());

      spaces.selectSpace('space-1');

      expect(store.allTags()).toEqual(['here-tag']);
    });

    it('combines the space with the search query', async () => {
      const { store, spaces } = await createStore([
        createNote({ id: 'here', spaceId: 'space-1', title: 'deploy' }),
        createNote({ id: 'elsewhere', spaceId: 'space-2', title: 'deploy' }),
      ]);

      spaces.selectSpace('space-1');
      store.setSearchQuery('deploy');

      expect(store.filteredNotes().map((note) => note.id)).toEqual(['here']);
    });
  });

  describe('sections', () => {
    it('groups notes chronologically when no search or tag filter is active', async () => {
      const { store } = await createStore([createNote({ id: 'a' })]);

      expect(store.isFiltering()).toBe(false);
      expect(store.sections().map((section) => section.key)).toContain('week');
    });

    it('switches to a single flat results section while searching', async () => {
      // Chronological grouping would bury an old match in a trailing section;
      // search results are read as a list.
      const old = createNote({ id: 'old', title: 'docker override', createdAt: new Date('2020-01-01') });
      const { store } = await createStore([old]);

      store.setSearchQuery('docker');

      expect(store.sections().map((section) => section.key)).toEqual(['results']);
      expect(store.sections()[0].notes).toEqual([old]);
    });

    it('surfaces a note far older than a week when it matches the search', async () => {
      const ancient = createNote({ id: 'ancient', title: 'git bisect', createdAt: new Date('2019-05-05') });
      const { store } = await createStore([ancient]);

      store.setSearchQuery('bisect');

      const visibleIds = store.sections().flatMap((section) => section.notes.map((note) => note.id));
      expect(visibleIds).toEqual(['ancient']);
    });

    it('switches to results mode when only a tag is selected', async () => {
      const { store } = await createStore([createNote({ id: 'a', tags: ['x'] })]);

      store.toggleTag('x');

      expect(store.isFiltering()).toBe(true);
      expect(store.sections().map((section) => section.key)).toEqual(['results']);
    });

    it('reports no results when a search matches nothing', async () => {
      const { store } = await createStore([createNote({ title: 'anything' })]);

      store.setSearchQuery('nothing matches this');

      expect(store.hasNoResults()).toBe(true);
    });

    it('does not report "no results" when nothing is being searched', async () => {
      const { store } = await createStore([]);

      expect(store.hasNoResults()).toBe(false);
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
  });

  describe('togglePinned', () => {
    it('persists the new pin state and adopts the stored note', async () => {
      const { store, repository } = await createStore([
        createNote({ id: 'a', pinned: false }),
        createNote({ id: 'b', pinned: false }),
      ]);
      const update = vi.spyOn(repository, 'update');

      await store.togglePinned('a');

      expect(update).toHaveBeenCalledWith('a', { pinned: true });
      expect(store.filteredNotes().find((note) => note.id === 'a')?.pinned).toBe(true);
      expect(store.filteredNotes().find((note) => note.id === 'b')?.pinned).toBe(false);
    });

    it('rolls the note back and notifies when persistence fails', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', pinned: false })]);
      const notifier = TestBed.inject(ErrorNotifier);
      repository.failNext = new Error('disk full');

      await store.togglePinned('a');

      expect(store.filteredNotes()[0].pinned).toBe(false);
      expect(notifier.notice()?.ref.key).toBe('errors.noteSaveFailed');
    });

    it('does nothing for an unknown id', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a' })]);
      const update = vi.spyOn(repository, 'update');

      await store.togglePinned('missing');

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('renameNote', () => {
    it('persists the new title and bumps updatedAt on the matching note only', async () => {
      const note = createNote({ id: 'a', title: 'Old title', updatedAt: new Date('2026-01-01') });
      const other = createNote({ id: 'b', title: 'Untouched' });
      const { store } = await createStore([note, other]);

      await store.renameNote('a', 'New title');

      const notes = store.filteredNotes();
      const updated = notes.find((n) => n.id === 'a');
      expect(updated?.title).toBe('New title');
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(note.updatedAt.getTime());
      expect(notes.find((n) => n.id === 'b')?.title).toBe('Untouched');
    });

    it('skips persistence when the title has not changed', async () => {
      // The overlay emits on every keystroke; an unchanged value must not
      // produce a write per character.
      const { store, repository } = await createStore([createNote({ id: 'a', title: 'Same' })]);
      const update = vi.spyOn(repository, 'update');

      await store.renameNote('a', 'Same');

      expect(update).not.toHaveBeenCalled();
    });

    it('restores the previous title when persistence fails', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', title: 'Original' })]);
      repository.failNext = new Error('nope');

      await store.renameNote('a', 'Attempted');

      expect(store.filteredNotes()[0].title).toBe('Original');
    });
  });

  describe('updateContent', () => {
    it('persists the new content', async () => {
      const { store } = await createStore([createNote({ id: 'a', content: 'before' })]);

      await store.updateContent('a', 'after');

      expect(store.filteredNotes()[0].content).toBe('after');
    });

    it('skips persistence when the content has not changed', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', content: 'same' })]);
      const update = vi.spyOn(repository, 'update');

      await store.updateContent('a', 'same');

      expect(update).not.toHaveBeenCalled();
    });

    it('restores the previous content when persistence fails', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', content: 'before' })]);
      repository.failNext = new Error('nope');

      await store.updateContent('a', 'after');

      expect(store.filteredNotes()[0].content).toBe('before');
    });
  });

  describe('setLanguage', () => {
    it('persists the new language', async () => {
      const { store } = await createStore([createNote({ id: 'a', language: 'txt' })]);

      await store.setLanguage('a', 'json');

      expect(store.filteredNotes()[0].language).toBe('json');
    });

    it('skips persistence when the language has not changed', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', language: 'json' })]);
      const update = vi.spyOn(repository, 'update');

      await store.setLanguage('a', 'json');

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('tags', () => {
    it('appends a tag', async () => {
      const { store } = await createStore([createNote({ id: 'a', tags: ['first'] })]);

      await store.addTag('a', 'second');

      expect(store.filteredNotes()[0].tags).toEqual(['first', 'second']);
    });

    it('normalises the submitted tag, hash and padding included', async () => {
      const { store } = await createStore([createNote({ id: 'a', tags: [] })]);

      await store.addTag('a', '  #urgent ');

      expect(store.filteredNotes()[0].tags).toEqual(['urgent']);
    });

    it('ignores a tag already present, whatever the casing', async () => {
      // Two spellings of the same tag would show up as two entries in the rail.
      const { store, repository } = await createStore([createNote({ id: 'a', tags: ['urgent'] })]);
      const update = vi.spyOn(repository, 'update');

      await store.addTag('a', 'URGENT');

      expect(update).not.toHaveBeenCalled();
    });

    it('ignores a tag that normalises to nothing', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', tags: [] })]);
      const update = vi.spyOn(repository, 'update');

      await store.addTag('a', ' # ');

      expect(update).not.toHaveBeenCalled();
    });

    it('removes a tag', async () => {
      const { store } = await createStore([createNote({ id: 'a', tags: ['keep', 'drop'] })]);

      await store.removeTag('a', 'drop');

      expect(store.filteredNotes()[0].tags).toEqual(['keep']);
    });

    it('does nothing when removing a tag the note does not carry', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', tags: ['keep'] })]);
      const update = vi.spyOn(repository, 'update');

      await store.removeTag('a', 'absent');

      expect(update).not.toHaveBeenCalled();
    });

    it('restores the tags when persistence fails', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a', tags: ['keep'] })]);
      repository.failNext = new Error('nope');

      await store.addTag('a', 'added');

      expect(store.filteredNotes()[0].tags).toEqual(['keep']);
    });
  });

  describe('createNote', () => {
    it('prepends the note returned by the repository and selects it', async () => {
      const { store } = await createStore([createNote({ id: 'existing' })]);

      await store.createNote();

      const notes = store.filteredNotes();
      expect(notes).toHaveLength(2);
      // Blank title and source: the UI renders translated placeholders rather
      // than storing French strings in the data.
      expect(notes[0]).toMatchObject({ title: '', source: '', content: '', pinned: false, tags: [] });
      expect(store.selectedNoteId()).toBe(notes[0].id);
    });

    it('takes its id from the repository rather than generating one locally', async () => {
      const { store } = await createStore([]);

      await store.createNote();

      expect(store.filteredNotes()[0].id).toBe('fake-1');
    });

    it('files the note in the selected space', async () => {
      const { store, spaces } = await createStore([]);

      spaces.selectSpace('space-2');
      await store.createNote();

      expect(store.filteredNotes()[0].spaceId).toBe('space-2');
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

    it('notifies and adds nothing when creation fails', async () => {
      const { store, repository } = await createStore([]);
      const notifier = TestBed.inject(ErrorNotifier);
      repository.failNext = new Error('read-only');

      await store.createNote();

      expect(store.filteredNotes()).toHaveLength(0);
      expect(notifier.notice()?.ref.key).toBe('errors.noteCreateFailed');
    });
  });

  describe('deleteNote', () => {
    it('removes the note and closes the overlay when it was the open one', async () => {
      const { store } = await createStore([createNote({ id: 'a' }), createNote({ id: 'b' })]);
      store.openNote('a');

      await store.deleteNote('a');

      expect(store.filteredNotes().map((note) => note.id)).toEqual(['b']);
      expect(store.selectedNoteId()).toBeNull();
    });

    it('leaves the open note alone when another one is deleted', async () => {
      const { store } = await createStore([createNote({ id: 'a' }), createNote({ id: 'b' })]);
      store.openNote('a');

      await store.deleteNote('b');

      expect(store.selectedNoteId()).toBe('a');
    });

    it('puts the note back where it was and notifies when deletion fails', async () => {
      // Restoring it at the top of the list would read as "deleted, and some
      // other note appeared".
      const notes = [createNote({ id: 'a' }), createNote({ id: 'b' }), createNote({ id: 'c' })];
      const { store, repository } = await createStore(notes);
      const notifier = TestBed.inject(ErrorNotifier);
      repository.failNext = new Error('locked');

      await store.deleteNote('b');

      expect(store.filteredNotes().map((note) => note.id)).toEqual(['a', 'b', 'c']);
      expect(notifier.notice()?.ref.key).toBe('errors.noteDeleteFailed');
    });

    it('does nothing for an unknown id', async () => {
      const { store, repository } = await createStore([createNote({ id: 'a' })]);
      const remove = vi.spyOn(repository, 'delete');

      await store.deleteNote('missing');

      expect(remove).not.toHaveBeenCalled();
    });
  });
});
