import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorNotifier } from '@core/services/errors/error-notifier.service';
import { createNote } from '@testing/note.fixture';
import { NotesHarness, awaitQuery, createNotesHarness, visibleIds } from '@testing/notes-harness';

describe('NoteSelectionStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    // The stores report failures through console.error on purpose; silence it
    // so a deliberately failing test doesn't look like a crash.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  describe('multiple selection', () => {
    async function withThreeNotes(): Promise<NotesHarness> {
      return createNotesHarness([createNote({ id: 'a' }), createNote({ id: 'b' }), createNote({ id: 'c' })]);
    }

    it('starts empty and reports no selection', async () => {
      const { selection } = await withThreeNotes();

      expect(selection.checkedCount()).toBe(0);
      expect(selection.hasSelection()).toBe(false);
    });

    it('toggles a note in and out of the selection', async () => {
      const { selection } = await withThreeNotes();

      selection.toggleChecked('b');
      expect(selection.checkedNotes().map((note) => note.id)).toEqual(['b']);

      selection.toggleChecked('b');
      expect(selection.hasSelection()).toBe(false);
    });

    it('never hands out a note that is no longer displayed', async () => {
      const { canvas, selection, repository } = await withThreeNotes();
      selection.toggleChecked('a');
      const before = repository.queryCount;

      repository.setView({ sections: [] });
      canvas.setFilter('pinned');
      await awaitQuery(repository, before);

      expect(selection.checkedNotes()).toEqual([]);
    });

    it('extends the selection from the focused note to the clicked one', async () => {
      const { selection } = await withThreeNotes();
      selection.focusNote('a');

      selection.checkRangeTo('c');

      expect(selection.checkedNotes().map((note) => note.id)).toEqual(['a', 'b', 'c']);
    });

    it('checks a single note when there is no anchor', async () => {
      const { selection } = await withThreeNotes();

      selection.checkRangeTo('b');

      expect(selection.checkedNotes().map((note) => note.id)).toEqual(['b']);
    });

    it('moves the whole selection in one call', async () => {
      const { store, selection, repository } = await withThreeNotes();
      selection.toggleChecked('a');
      selection.toggleChecked('c');

      await store.moveSelection('space-2');

      expect(repository.movedTo).toEqual({ ids: ['a', 'c'], spaceId: 'space-2' });
    });

    it('sends the typed tag through untouched', async () => {
      const { store, selection, repository } = await withThreeNotes();
      selection.toggleChecked('a');

      await store.tagSelection('#Urgent');

      expect(repository.taggedWith).toEqual({ ids: ['a'], tags: ['#Urgent'] });
    });

    it('ignores a blank tag rather than sending it', async () => {
      const { store, selection, repository } = await withThreeNotes();
      selection.toggleChecked('a');

      await store.tagSelection('   ');

      expect(repository.taggedWith).toBeNull();
    });

    it('does nothing at all without a selection', async () => {
      const { store, canvas, repository } = await withThreeNotes();

      await store.moveSelection('space-2');
      await store.tagSelection('urgent');
      await store.deleteSelection();

      expect(repository.movedTo).toBeNull();
      expect(repository.taggedWith).toBeNull();
      expect(visibleIds(canvas)).toEqual(['a', 'b', 'c']);
    });

    /**
     * ⚠️ The asymmetry this closes: deleting a note had three safety nets, and moving
     * thirty of them had none — where putting a move back by hand means remembering
     * which thirty, and which space each one came from.
     */
    it('offers to put a move back, space by space', async () => {
      const { store, selection, repository } = await createNotesHarness([
        createNote({ id: 'a', spaceId: 'space-1' }),
        createNote({ id: 'b', spaceId: 'space-2' }),
      ]);
      selection.toggleChecked('a');
      selection.toggleChecked('b');

      await store.moveSelection('space-3');

      expect(store.undoBanner()).toEqual({
        kind: 'move',
        previous: [
          { noteId: 'a', spaceId: 'space-1' },
          { noteId: 'b', spaceId: 'space-2' },
        ],
        count: 2,
      });

      const queries = repository.queryCount;
      await store.undoLastAction();
      await awaitQuery(repository, queries);

      expect(repository.spaceOf('a')).toBe('space-1');
      expect(repository.spaceOf('b')).toBe('space-2');
    });

    it('offers to put a tagging back', async () => {
      const { store, selection, repository } = await createNotesHarness([createNote({ id: 'a', tags: [] })]);
      selection.toggleChecked('a');

      await store.tagSelection('urgent');

      expect(store.undoBanner()?.kind).toBe('tag');

      const queries = repository.queryCount;
      await store.undoLastAction();
      await awaitQuery(repository, queries);

      expect(repository.tagsOf('a')).toEqual([]);
    });

    /**
     * ⚠️ The reason the back end answers pairs rather than a count: the note that already
     * carried the tag gained nothing, so the undo must not take it away.
     */
    it('undoing a tagging leaves the tag on the note that already carried it', async () => {
      const { store, selection, repository } = await createNotesHarness([
        createNote({ id: 'a', tags: ['Urgent'] }),
        createNote({ id: 'b', tags: [] }),
      ]);
      selection.toggleChecked('a');
      selection.toggleChecked('b');

      await store.tagSelection('urgent');
      const queries = repository.queryCount;
      await store.undoLastAction();
      await awaitQuery(repository, queries);

      expect(repository.tagsOf('a')).toEqual(['Urgent']);
      expect(repository.tagsOf('b')).toEqual([]);
    });

    /** A bar offering to undo nothing is noise, not a safety net. */
    it('offers no undo when the batch changed nothing', async () => {
      const { store, selection } = await createNotesHarness([createNote({ id: 'a', spaceId: 'space-1' })]);
      selection.toggleChecked('a');

      await store.moveSelection('space-1');

      expect(store.undoBanner()).toBeNull();
      expect(store.lastAction()).toBeNull();
    });

    it('reports a failed bulk action without clearing the selection', async () => {
      const { store, selection, repository } = await withThreeNotes();
      const notifier = TestBed.inject(ErrorNotifier);
      selection.toggleChecked('a');
      repository.failNext = new Error('boom');

      await store.moveSelection('space-2');

      expect(notifier.notice()?.ref.key).toBe('errors.bulkActionFailed');
      expect(selection.checkedCount()).toBe(1);
    });
  });

  describe('keyboard focus', () => {
    it('flattens the sections in display order', async () => {
      const { canvas, repository } = await createNotesHarness([createNote({ id: 'a' })]);
      const before = repository.queryCount;
      repository.setView({
        sections: [
          {
            key: 'pinned',
            notes: [createNote({ id: 'p' })],
            hasExpiringNotes: false,
            showCreateGhost: false,
          },
          {
            key: 'week',
            notes: [createNote({ id: 'w' })],
            hasExpiringNotes: false,
            showCreateGhost: false,
          },
        ],
      });
      canvas.setFilter('pinned');
      await awaitQuery(repository, before);

      expect(canvas.visibleNotes().map((note) => note.id)).toEqual(['p', 'w']);
    });

    it('reports no index when nothing is focused', async () => {
      const { selection } = await createNotesHarness([createNote({ id: 'a' })]);

      expect(selection.focusedIndex()).toBe(-1);
    });

    it('focuses by position, which survives a rename', async () => {
      const { selection } = await createNotesHarness([createNote({ id: 'a' }), createNote({ id: 'b' })]);

      selection.focusIndex(1);

      expect(selection.focusedNoteId()).toBe('b');
      expect(selection.focusedIndex()).toBe(1);
    });

    it('ignores a position outside the grid', async () => {
      const { selection } = await createNotesHarness([createNote({ id: 'a' })]);
      selection.focusIndex(0);

      selection.focusIndex(9);

      expect(selection.focusedNoteId()).toBe('a');
    });

    it('follows the note being opened', async () => {
      const { store, selection } = await createNotesHarness([
        createNote({ id: 'a' }),
        createNote({ id: 'b' }),
      ]);

      store.openNote('b');

      expect(selection.focusedNoteId()).toBe('b');
    });
  });
});
