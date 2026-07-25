import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTES_REPOSITORY } from '../data/notes-repository.token';
import { Note } from '../models/note.model';
import { createNote } from '../../../testing/note.fixture';
import { FakeNotesRepository } from '../../../testing/fake-notes-repository';
import { NotesStore } from './notes.store';

/** Creates a `NotesStore` backed by a `FakeNotesRepository` and waits for the initial load to settle. */
async function createStore(notes: Note[]): Promise<NotesStore> {
  TestBed.configureTestingModule({
    providers: [{ provide: NOTES_REPOSITORY, useValue: new FakeNotesRepository(notes) }],
  });
  const store = TestBed.inject(NotesStore);
  await vi.waitFor(() => expect(store.filteredNotes().length).toBe(notes.length));
  return store;
}

describe('NotesStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads notes from the repository on creation', async () => {
    const notes = [createNote({ id: 'a' }), createNote({ id: 'b' })];

    const store = await createStore(notes);

    expect(store.filteredNotes().map((note) => note.id)).toEqual(['a', 'b']);
  });

  describe('allTags', () => {
    it('returns the sorted, de-duplicated set of tags across all notes', async () => {
      const store = await createStore([
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
      const store = await createStore([target, other]);

      store.setSearchQuery('DEPLOY');

      expect(store.filteredNotes()).toEqual([target]);
    });

    it('keeps only pinned notes when the "pinned" filter is active', async () => {
      const pinned = createNote({ id: 'pinned', pinned: true });
      const unpinned = createNote({ id: 'unpinned', pinned: false });
      const store = await createStore([pinned, unpinned]);

      store.setFilter('pinned');

      expect(store.filteredNotes()).toEqual([pinned]);
    });

    it('keeps only expiring notes when the "untriaged" filter is active', async () => {
      const expiring = createNote({ id: 'expiring', lifecycle: { kind: 'expires', at: new Date('2026-02-01') } });
      const permanent = createNote({ id: 'permanent', lifecycle: { kind: 'permanent' } });
      const store = await createStore([expiring, permanent]);

      store.setFilter('untriaged');

      expect(store.filteredNotes()).toEqual([expiring]);
    });

    it('keeps only notes matching at least one selected tag', async () => {
      const matching = createNote({ id: 'matching', tags: ['urgent'] });
      const other = createNote({ id: 'other', tags: ['later'] });
      const store = await createStore([matching, other]);

      store.toggleTag('urgent');

      expect(store.filteredNotes()).toEqual([matching]);
    });

    it('un-selects a tag when toggled twice', async () => {
      const notes = [createNote({ id: 'a', tags: ['urgent'] }), createNote({ id: 'b', tags: ['later'] })];
      const store = await createStore(notes);

      store.toggleTag('urgent');
      store.toggleTag('urgent');

      expect(store.filteredNotes()).toEqual(notes);
    });

    it('combines search, filter and tag criteria', async () => {
      const target = createNote({ id: 'target', title: 'Deploy notes', pinned: true, tags: ['urgent'] });
      const wrongTag = createNote({ id: 'wrong-tag', title: 'Deploy notes', pinned: true, tags: ['later'] });
      const notPinned = createNote({ id: 'not-pinned', title: 'Deploy notes', pinned: false, tags: ['urgent'] });
      const store = await createStore([target, wrongTag, notPinned]);

      store.setSearchQuery('deploy');
      store.setFilter('pinned');
      store.toggleTag('urgent');

      expect(store.filteredNotes()).toEqual([target]);
    });
  });

  describe('selection', () => {
    it('exposes the selected note and clears it on close', async () => {
      const note = createNote({ id: 'selected' });
      const store = await createStore([note]);

      store.openNote('selected');
      expect(store.selectedNote()).toEqual(note);

      store.closeOverlay();
      expect(store.selectedNote()).toBeNull();
    });

    it('returns null when the selected id does not match any note', async () => {
      const store = await createStore([createNote({ id: 'a' })]);

      store.openNote('does-not-exist');

      expect(store.selectedNote()).toBeNull();
    });
  });

  describe('togglePinned', () => {
    it('flips the pinned flag of the matching note only', async () => {
      const notes = [createNote({ id: 'a', pinned: false }), createNote({ id: 'b', pinned: false })];
      const store = await createStore(notes);

      store.togglePinned('a');

      expect(store.filteredNotes().find((note) => note.id === 'a')?.pinned).toBe(true);
      expect(store.filteredNotes().find((note) => note.id === 'b')?.pinned).toBe(false);
    });
  });

  describe('renameNote', () => {
    it('updates the title and bumps updatedAt on the matching note only', async () => {
      const note = createNote({ id: 'a', title: 'Old title', updatedAt: new Date('2026-01-01') });
      const other = createNote({ id: 'b', title: 'Untouched' });
      const store = await createStore([note, other]);

      store.renameNote('a', 'New title');

      const notes = store.filteredNotes();
      const updated = notes.find((n) => n.id === 'a');
      expect(updated?.title).toBe('New title');
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(note.updatedAt.getTime());
      expect(notes.find((n) => n.id === 'b')?.title).toBe('Untouched');
    });
  });

  describe('createDraftNote', () => {
    it('prepends a new untitled note and selects it', async () => {
      const store = await createStore([createNote({ id: 'existing' })]);

      store.createDraftNote();

      const notes = store.filteredNotes();
      expect(notes).toHaveLength(2);
      expect(notes[0]).toMatchObject({ title: 'Nouvelle note', content: '', pinned: false, tags: [] });
      expect(store.selectedNoteId()).toBe(notes[0].id);
    });
  });
});
