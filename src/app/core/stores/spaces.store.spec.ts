import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { Space } from '@core/models/space.model';
import { FakeSpacesRepository } from '@testing/fake-spaces-repository';
import { provideAppTesting } from '@testing/testing.providers';
import { SpacesStore } from './spaces.store';

const SPACES: readonly Space[] = [
  { id: 'work', name: 'Work' },
  { id: 'personal', name: 'Personal' },
];

interface Harness {
  readonly store: SpacesStore;
  readonly repository: FakeSpacesRepository;
}

async function createStore(spaces: readonly Space[] = SPACES): Promise<Harness> {
  const repository = new FakeSpacesRepository(spaces);
  TestBed.configureTestingModule({ providers: [provideAppTesting({ spacesRepository: repository })] });

  const store = TestBed.inject(SpacesStore);
  await vi.waitFor(() => expect(store.isLoading()).toBe(false));

  return { store, repository };
}

describe('SpacesStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    // Failures are reported through console.error on purpose; silence it so a
    // deliberately failing test doesn't look like a crash.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('loads the spaces from the repository', async () => {
    const { store } = await createStore();

    expect(store.spaces()).toEqual(SPACES);
  });

  it('starts on "all spaces" rather than on an arbitrary one', async () => {
    const { store } = await createStore();

    expect(store.activeSpace()).toBeNull();
    expect(store.activeSpaceId()).toBeNull();
  });

  it('exposes the selected space', async () => {
    const { store } = await createStore();

    store.selectSpace('personal');

    expect(store.activeSpace()).toEqual(SPACES[1]);
    expect(store.activeSpaceId()).toBe('personal');
  });

  it('goes back to "all spaces" when selecting null', async () => {
    const { store } = await createStore();
    store.selectSpace('work');

    store.selectSpace(null);

    expect(store.activeSpace()).toBeNull();
  });

  it('falls back to "all spaces" when the selected id matches no space', async () => {
    // Otherwise a stale id — a space deleted elsewhere — would hide every note
    // with no way to tell why.
    const { store } = await createStore();

    store.selectSpace('does-not-exist');

    expect(store.activeSpace()).toBeNull();
    expect(store.activeSpaceId()).toBeNull();
  });

  it('surfaces a load failure through the error notifier', async () => {
    // Nothing on screen goes blank when spaces fail to load, so without the
    // banner the failure would be invisible.
    const repository = new FakeSpacesRepository(SPACES);
    repository.failNext = new Error('backend down');
    TestBed.configureTestingModule({ providers: [provideAppTesting({ spacesRepository: repository })] });
    const notifier = TestBed.inject(ErrorNotifier);

    TestBed.inject(SpacesStore);

    await vi.waitFor(() => expect(notifier.notice()?.ref.key).toBe('errors.spacesLoadFailed'));
    expect(notifier.notice()?.detail).toBe('backend down');
  });

  describe('createSpace', () => {
    it('appends the space returned by the repository and selects it', async () => {
      const { store } = await createStore();

      const created = await store.createSpace('Side project');

      expect(created?.name).toBe('Side project');
      expect(store.spaces().map((space) => space.name)).toEqual(['Work', 'Personal', 'Side project']);
      expect(store.activeSpaceId()).toBe(created?.id);
    });

    it('takes the id from the repository rather than generating one locally', async () => {
      const { store } = await createStore([]);

      const created = await store.createSpace('First');

      expect(created?.id).toBe('fake-space-1');
    });

    it('trims the submitted name', async () => {
      const { store } = await createStore([]);

      const created = await store.createSpace('  Padded  ');

      expect(created?.name).toBe('Padded');
    });

    it('ignores a blank name without calling the repository', async () => {
      const { store, repository } = await createStore();
      const create = vi.spyOn(repository, 'create');

      const created = await store.createSpace('   ');

      expect(created).toBeNull();
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses a name already taken, whatever the casing', async () => {
      // Two identically named spaces are indistinguishable in the switcher.
      const { store, repository } = await createStore();
      const notifier = TestBed.inject(ErrorNotifier);
      const create = vi.spyOn(repository, 'create');

      const created = await store.createSpace('  wORK ');

      expect(created).toBeNull();
      expect(create).not.toHaveBeenCalled();
      expect(notifier.notice()?.ref.key).toBe('errors.spaceNameTaken');
    });

    it('notifies and adds nothing when creation fails', async () => {
      const { store, repository } = await createStore();
      const notifier = TestBed.inject(ErrorNotifier);
      repository.failNext = new Error('read-only');

      const created = await store.createSpace('Doomed');

      expect(created).toBeNull();
      expect(store.spaces()).toEqual(SPACES);
      expect(notifier.notice()?.ref.key).toBe('errors.spaceCreateFailed');
    });
  });
});
