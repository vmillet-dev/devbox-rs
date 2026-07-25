import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Space } from '@core/models/space.model';
import { provideAppTesting } from '@testing/testing.providers';
import { SpacesStore } from './spaces.store';

const SPACES: readonly Space[] = [
  { id: 'all', name: 'All spaces' },
  { id: 'work', name: 'Work' },
];

async function createStore(spaces: readonly Space[] = SPACES): Promise<SpacesStore> {
  TestBed.configureTestingModule({ providers: [provideAppTesting({ spaces })] });
  const store = TestBed.inject(SpacesStore);
  await vi.waitFor(() => expect(store.spaces()).toHaveLength(spaces.length));
  return store;
}

describe('SpacesStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads the spaces from the repository', async () => {
    const store = await createStore();

    expect(store.spaces()).toEqual(SPACES);
  });

  it('defaults the active space to the first one', async () => {
    const store = await createStore();

    expect(store.activeSpace()).toEqual(SPACES[0]);
  });

  it('exposes the selected space', async () => {
    const store = await createStore();

    store.selectSpace('work');

    expect(store.activeSpace()).toEqual(SPACES[1]);
  });

  it('falls back to the first space when the selected id is unknown', async () => {
    const store = await createStore();

    store.selectSpace('does-not-exist');

    expect(store.activeSpace()).toEqual(SPACES[0]);
  });

  it('reports a null active space while no space is available', async () => {
    const store = await createStore([]);

    expect(store.activeSpace()).toBeNull();
  });
});
