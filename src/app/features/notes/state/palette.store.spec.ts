import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAppWindow } from '@testing/fake-app-window';
import { FakeClipboard } from '@testing/fake-clipboard';
import { FakeNotesRepository } from '@testing/fake-notes-repository';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { SEARCH_DEBOUNCE_MS } from './notes.store';
import { PaletteStore } from './palette.store';

interface Harness {
  readonly store: PaletteStore;
  readonly repository: FakeNotesRepository;
  readonly clipboard: FakeClipboard;
  readonly window: FakeAppWindow;
}

function createStore(): Harness {
  TestBed.resetTestingModule();
  const repository = new FakeNotesRepository([
    createNote({ id: 'note-1', title: 'First', content: 'plain body' }),
    createNote({
      id: 'note-2',
      title: 'Templated',
      content: 'psql -h {{host}}',
      placeholders: [{ name: 'host', defaultValue: '' }],
    }),
  ]);
  const clipboard = new FakeClipboard();
  const appWindow = new FakeAppWindow();
  TestBed.configureTestingModule({
    providers: [provideAppTesting({ notesRepository: repository, clipboard, appWindow })],
  });

  return { store: TestBed.inject(PaletteStore), repository, clipboard, window: appWindow };
}

describe('PaletteStore', () => {
  let harness: Harness;

  beforeEach(async () => {
    // Seuls les timers de la temporisation : `requestAnimationFrame` truqué
    // bloquerait l'ordonnanceur zoneless d'Angular.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    harness = createStore();
    await harness.store.open();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches every space, ignoring the canvas filters', async () => {
    // On ne se souvient pas de l'espace où un snippet a été rangé.
    expect(harness.repository.lastQuery?.spaceId).toBeNull();
    expect(harness.repository.lastQuery?.filter).toBe('all');
    expect(harness.repository.lastQuery?.tags).toEqual([]);
  });

  it('opens on the most recent notes rather than an empty list', () => {
    expect(harness.store.results()).toHaveLength(2);
    expect(harness.store.highlightedNote()?.id).toBe('note-1');
  });

  it('defers the query while typing', async () => {
    const before = harness.repository.queryCount;

    harness.store.setQuery('psql');
    expect(harness.repository.queryCount).toBe(before);

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(harness.repository.lastQuery?.search).toBe('psql');
  });

  it('stops at the ends of the list instead of wrapping', () => {
    harness.store.moveHighlight(-1);
    expect(harness.store.highlighted()).toBe(0);

    harness.store.moveHighlight(1);
    harness.store.moveHighlight(1);
    expect(harness.store.highlighted()).toBe(1);
  });

  it('copies the chosen snippet and gets out of the way', async () => {
    await harness.store.chooseHighlighted();

    expect(harness.clipboard.content).toBe('plain body');
    expect(harness.store.isOpen()).toBe(false);
    // La fenêtre s'efface : l'utilisateur repart coller là où il était.
    expect(harness.window.hidden).toBe(1);
  });

  it('asks for the fields before copying a templated snippet', async () => {
    harness.store.highlight(1);

    await harness.store.chooseHighlighted();

    expect(harness.store.pendingFill()?.id).toBe('note-2');
    expect(harness.clipboard.content).toBe('');
    expect(harness.store.isOpen()).toBe(true);
  });

  it('drops the pending fill when the palette closes', async () => {
    harness.store.highlight(1);
    await harness.store.chooseHighlighted();

    harness.store.close();

    expect(harness.store.pendingFill()).toBeNull();
  });

  it('keeps the window in place when the clipboard refuses', async () => {
    harness.clipboard.failNext = new Error('no clipboard');

    await harness.store.chooseHighlighted();

    expect(harness.store.isOpen()).toBe(true);
    expect(harness.window.hidden).toBe(0);
  });
  describe('creating from what was typed', () => {
    it('offers nothing to create on an empty query', () => {
      // Rouvrir la palette sans taper doit montrer les notes récentes, pas
      // proposer de créer une note vide.
      expect(harness.store.canCreate()).toBe(false);
      expect(harness.store.optionCount()).toBe(2);
    });

    it('appends the create row after the results', async () => {
      // Retrouver un snippet reste le geste le plus fréquent : il garde la
      // première place.
      harness.store.setQuery('psql');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

      expect(harness.store.canCreate()).toBe(true);
      expect(harness.store.optionCount()).toBe(harness.store.results().length + 1);
      expect(harness.store.isCreateHighlighted()).toBe(false);
    });

    it('walks onto the create row and stops there', async () => {
      harness.store.setQuery('psql');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

      harness.store.moveHighlight(1);
      harness.store.moveHighlight(1);
      harness.store.moveHighlight(1);

      expect(harness.store.isCreateHighlighted()).toBe(true);
      expect(harness.store.highlighted()).toBe(harness.store.results().length);
    });

    it('highlights the create row first when nothing matches', async () => {
      harness.repository.setView({ sections: [] });
      harness.store.setQuery('rien ne correspond');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

      expect(harness.store.isCreateHighlighted()).toBe(true);
    });

    it('hands the typed text over and closes', async () => {
      // Le store ne crée pas lui-même : il ne connaît pas `NotesStore`.
      harness.repository.setView({ sections: [] });
      harness.store.setQuery('  penser à migrer la base  ');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

      expect(harness.store.takeNewNoteContent()).toBe('penser à migrer la base');
      expect(harness.store.isOpen()).toBe(false);
    });

    it('hands nothing over while a snippet is highlighted', async () => {
      harness.store.setQuery('psql');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

      expect(harness.store.takeNewNoteContent()).toBeNull();
      expect(harness.store.isOpen()).toBe(true);
    });

    it('copies rather than creating when a snippet is chosen', async () => {
      harness.store.setQuery('plain');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

      await harness.store.chooseHighlighted();

      expect(harness.clipboard.content).toBe('plain body');
    });
  });
});
