import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FakeNotesRepository } from '@testing/fake-notes-repository';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { TagsStore } from './tags.store';

interface Harness {
  readonly store: TagsStore;
  readonly repository: FakeNotesRepository;
  readonly notifier: ErrorNotifier;
}

function createStore(): Harness {
  TestBed.resetTestingModule();
  const repository = new FakeNotesRepository([
    createNote({ id: 'note-1', tags: ['auth', 'api'] }),
    createNote({ id: 'note-2', tags: ['auth'] }),
  ]);
  TestBed.configureTestingModule({ providers: [provideAppTesting({ notesRepository: repository })] });

  return {
    store: TestBed.inject(TagsStore),
    repository,
    notifier: TestBed.inject(ErrorNotifier),
  };
}

describe('TagsStore', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createStore();
  });

  it('lists every tag of the corpus with its note count', async () => {
    await harness.store.open();

    expect(harness.store.tags()).toEqual([
      { tag: 'api', noteCount: 1 },
      { tag: 'auth', noteCount: 2 },
    ]);
  });

  it('starts each opening with an empty selection', async () => {
    await harness.store.open();
    harness.store.toggle('auth');
    harness.store.close();

    await harness.store.open();

    expect(harness.store.selectedCount()).toBe(0);
  });

  it('renames a single selected tag', async () => {
    await harness.store.open();
    harness.store.toggle('auth');

    expect(await harness.store.renameSelected('identity')).toBe(true);
    expect(harness.repository.retagged).toEqual({ tags: ['auth'], into: 'identity' });
  });

  it('merges when several tags are selected', async () => {
    // Renommer vers un tag existant *est* une fusion côté base : le store ne
    // fait que choisir la commande dont le nom le dit.
    await harness.store.open();
    harness.store.toggle('auth');
    harness.store.toggle('api');

    await harness.store.renameSelected('backend');

    expect(harness.repository.retagged?.tags).toEqual(['auth', 'api']);
    expect(harness.repository.retagged?.into).toBe('backend');
  });

  it('refuses to rename towards nothing', async () => {
    await harness.store.open();
    harness.store.toggle('auth');

    expect(await harness.store.renameSelected('   ')).toBe(false);
    expect(harness.repository.retagged).toBeNull();
  });

  it('does nothing without a selection', async () => {
    await harness.store.open();

    expect(await harness.store.renameSelected('identity')).toBe(false);
    expect(await harness.store.deleteSelected()).toBe(false);
  });

  it('drops every selected tag and clears the selection', async () => {
    await harness.store.open();
    harness.store.toggle('auth');
    harness.store.toggle('api');

    expect(await harness.store.deleteSelected()).toBe(true);
    expect(harness.repository.deletedTags).toEqual(['auth', 'api']);
    expect(harness.store.selectedCount()).toBe(0);
    expect(harness.store.isEmpty()).toBe(true);
  });

  it('surfaces a load failure', async () => {
    harness.repository.failNext = new Error('boom');

    await harness.store.open();

    expect(harness.notifier.notice()?.ref.key).toBe('errors.tagsLoadFailed');
  });

  it('keeps the selection when an action fails', async () => {
    await harness.store.open();
    harness.store.toggle('auth');
    harness.repository.failNext = new Error('boom');

    expect(await harness.store.renameSelected('identity')).toBe(false);
    expect(harness.store.selectedCount()).toBe(1);
    expect(harness.notifier.notice()?.ref.key).toBe('errors.tagActionFailed');
  });
});
