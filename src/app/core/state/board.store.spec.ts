import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesService } from '@core/services/preferences/preferences.service';
import { createNote } from '@testing/note.fixture';
import { FakeBoardRepository, fakeBoardNote, fakeZone } from '@testing/fake-board-repository';
import { FakeSpacesRepository } from '@testing/fake-spaces-repository';
import { provideAppTesting } from '@testing/testing.providers';
import { Folder } from '../model/folder.model';
import { Space } from '../model/space.model';
import { BoardStore } from './board.store';
import { NotesQueryStore } from './notes-query.store';
import { SpacesStore } from './spaces.store';

const SPACES: readonly Space[] = [
  { id: 'sql', name: 'SQL', pinned: false },
  { id: 'veille', name: 'Veille', pinned: false },
];

const PERF: Folder = {
  id: 'perf',
  spaceId: 'sql',
  name: 'Perf',
  colour: 'amber',
  createdAt: new Date('2026-01-01T10:00:00Z'),
};

interface Harness {
  readonly store: BoardStore;
  readonly spaces: SpacesStore;
  readonly canvas: NotesQueryStore;
  readonly repository: FakeBoardRepository;
  readonly preferences: PreferencesService;
}

async function createStore(repository = new FakeBoardRepository()): Promise<Harness> {
  TestBed.configureTestingModule({
    providers: [
      provideAppTesting({
        boardRepository: repository,
        spacesRepository: new FakeSpacesRepository(SPACES),
      }),
    ],
  });

  const spaces = TestBed.inject(SpacesStore);
  await vi.waitFor(() => expect(spaces.spaces()).toHaveLength(SPACES.length));

  return {
    store: TestBed.inject(BoardStore),
    spaces,
    canvas: TestBed.inject(NotesQueryStore),
    repository,
    preferences: TestBed.inject(PreferencesService),
  };
}

async function onBoard(harness: Harness, spaceId = 'sql'): Promise<void> {
  harness.spaces.selectSpace(spaceId);
  harness.store.setMode('board');
  await vi.waitFor(() => expect(harness.repository.queryCount).toBeGreaterThan(0));
}

describe('BoardStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    vi.restoreAllMocks();
    // Failures are reported through console.error on purpose.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('starts on the date view, which stays the default', async () => {
    const { store } = await createStore();

    expect(store.mode()).toBe('date');
    expect(store.isBoard()).toBe(false);
  });

  /** ⚠️ A folder belongs to a space, so there would be no zones to draw. */
  it('refuses the board while the user is on all spaces', async () => {
    const { store } = await createStore();

    store.setMode('board');

    expect(store.canShowBoard()).toBe(false);
    expect(store.mode()).toBe('date');
  });

  it('asks nothing at all while the date view is showing', async () => {
    const { store, spaces, repository } = await createStore();
    spaces.selectSpace('sql');
    await vi.waitFor(() => expect(store.canShowBoard()).toBe(true));

    expect(repository.queryCount).toBe(0);
  });

  it('draws the zones and the loose cards the back end answered', async () => {
    const repository = new FakeBoardRepository({
      zones: [fakeZone({ folder: PERF, notes: [fakeBoardNote(createNote({ id: 'a' }))] })],
      loose: [fakeBoardNote(createNote({ id: 'b' }), { position: { x: 16, y: 400 } })],
      width: 1200,
      height: 800,
    });
    const harness = await createStore(repository);

    await onBoard(harness);

    expect(harness.store.zones()).toHaveLength(1);
    expect(harness.store.zones()[0]?.folder.name).toBe('Perf');
    expect(harness.store.loose()).toHaveLength(1);
    expect(harness.store.width()).toBe(1200);
    expect(harness.store.noteCount()).toBe(2);
  });

  it('queries the active space with what the header is filtering on', async () => {
    const harness = await createStore();
    harness.canvas.setFilter('pinned');
    harness.canvas.toggleTag('sql');

    await onBoard(harness);

    expect(harness.repository.lastQuery?.spaceId).toBe('sql');
    expect(harness.repository.lastQuery?.filter).toBe('pinned');
    expect(harness.repository.lastQuery?.tags).toEqual(['sql']);
  });

  /** ⚠️ Without the `equal` comparator a fresh literal fires a query on every tick. */
  it('does not re-query when nothing it reads has moved', async () => {
    const harness = await createStore();
    await onBoard(harness);
    const before = harness.repository.queryCount;

    harness.store.setMode('board');
    await Promise.resolve();

    expect(harness.repository.queryCount).toBe(before);
  });

  it('re-queries when a filter moves', async () => {
    const harness = await createStore();
    await onBoard(harness);
    const before = harness.repository.queryCount;

    harness.canvas.setFilter('pinned');

    await vi.waitFor(() => expect(harness.repository.queryCount).toBeGreaterThan(before));
  });

  /** Per space, so arranging one does not switch the others. */
  it('remembers the view of each space on its own', async () => {
    const harness = await createStore();
    await onBoard(harness, 'sql');

    harness.spaces.selectSpace('veille');
    await vi.waitFor(() => expect(harness.store.mode()).toBe('date'));

    harness.spaces.selectSpace('sql');
    await vi.waitFor(() => expect(harness.store.mode()).toBe('board'));
  });

  it('writes the chosen view to the preferences under a key of its own', async () => {
    const harness = await createStore();
    const write = vi.spyOn(harness.preferences, 'write');

    await onBoard(harness);

    expect(write).toHaveBeenCalledWith('devbox.notes.view.sql', 'board');
  });

  it('reports what a search dimmed rather than what it removed', async () => {
    const repository = new FakeBoardRepository({
      zones: [
        fakeZone({
          folder: PERF,
          notes: [
            fakeBoardNote(createNote({ id: 'a' })),
            fakeBoardNote(createNote({ id: 'b' }), { matches: false }),
          ],
        }),
      ],
      isFiltering: true,
      matched: 1,
    });
    const harness = await createStore(repository);

    await onBoard(harness);

    expect(harness.store.zones()[0]?.notes).toHaveLength(2);
    expect(harness.store.matched()).toBe(1);
  });

  it('reports no count while nothing is dimming anything', async () => {
    const harness = await createStore();

    await onBoard(harness);

    expect(harness.store.matched()).toBeNull();
  });

  it('reports a failed load and draws nothing', async () => {
    const repository = new FakeBoardRepository();
    repository.failNext = new Error('locked');
    const harness = await createStore(repository);

    harness.spaces.selectSpace('sql');
    harness.store.setMode('board');

    await vi.waitFor(() => expect(harness.store.loadError()).toBeDefined());
    expect(harness.store.zones()).toEqual([]);
  });
});
