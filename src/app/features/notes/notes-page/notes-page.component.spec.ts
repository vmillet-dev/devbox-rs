import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Space } from '@core/models/space.model';
import { NotesStore } from '@core/stores/notes.store';
import { SpacesStore } from '@core/stores/spaces.store';
import { FakeNotesRepository } from '@testing/fake-notes-repository';
import { createNote } from '@testing/note.fixture';
import { createSection } from '@testing/section.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { FilterChipsComponent } from '../components/filter-chips/filter-chips.component';
import { NoteEditorOverlayComponent } from '../components/note-editor-overlay/note-editor-overlay.component';
import { NoteSectionComponent } from '../components/note-section/note-section.component';
import { SearchBoxComponent } from '../components/search-box/search-box.component';
import { SpaceSwitcherComponent } from '../components/space-switcher/space-switcher.component';
import { TagRailComponent } from '../components/tag-rail/tag-rail.component';
import { NotesPageComponent } from './notes-page.component';

const SPACES: readonly Space[] = [
  { id: 'space-1', name: 'Space one' },
  { id: 'work', name: 'Work' },
];

describe('NotesPageComponent', () => {
  let fixture: ComponentFixture<NotesPageComponent>;
  let store: NotesStore;
  let spaces: SpacesStore;
  let repository: FakeNotesRepository;

  function child<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type)).componentInstance as T;
  }

  function maybeChild<T>(type: new (...args: never[]) => T): T | null {
    return (fixture.debugElement.query(By.directive(type))?.componentInstance as T) ?? null;
  }

  function sections(): NoteSectionComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(NoteSectionComponent))
      .map((el) => el.componentInstance as NoteSectionComponent);
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    repository = new FakeNotesRepository([createNote({ id: 'note-42' })]);
    TestBed.configureTestingModule({
      imports: [NotesPageComponent],
      providers: [provideAppTesting({ notesRepository: repository, spaces: SPACES })],
    });
    fixture = TestBed.createComponent(NotesPageComponent);
    store = TestBed.inject(NotesStore);
    spaces = TestBed.inject(SpacesStore);
    fixture.autoDetectChanges();
    await vi.waitFor(() => expect(spaces.spaces()).toHaveLength(SPACES.length));
  });

  it('renders the toolbar with the store search/filter state and the active space', async () => {
    store.setSearchQuery('hello');
    store.setFilter('pinned');
    spaces.selectSpace('work');
    await fixture.whenStable();

    expect(child(SpaceSwitcherComponent).spaces()).toEqual(SPACES);
    expect(child(SpaceSwitcherComponent).activeSpace()).toEqual(SPACES[1]);
    expect(child(SearchBoxComponent).query()).toBe('hello');
    expect(child(FilterChipsComponent).active()).toBe('pinned');
  });

  it('starts on "all spaces"', async () => {
    await fixture.whenStable();

    expect(child(SpaceSwitcherComponent).activeSpace()).toBeNull();
  });

  it('updates the active space when the switcher reports a space change', async () => {
    child(SpaceSwitcherComponent).spaceChanged.emit('work');
    await fixture.whenStable();

    expect(child(SpaceSwitcherComponent).activeSpace()).toEqual(SPACES[1]);
  });

  it('goes back to "all spaces" when the switcher reports a null space', async () => {
    child(SpaceSwitcherComponent).spaceChanged.emit('work');
    await fixture.whenStable();

    child(SpaceSwitcherComponent).spaceChanged.emit(null);
    await fixture.whenStable();

    expect(child(SpaceSwitcherComponent).activeSpace()).toBeNull();
  });

  it('creates a space when the switcher reports one', () => {
    const createSpace = vi.spyOn(spaces, 'createSpace').mockResolvedValue(null);

    child(SpaceSwitcherComponent).spaceCreated.emit('Side project');

    expect(createSpace).toHaveBeenCalledWith('Side project');
  });

  it('delegates search, filter and new-note requests to the store', () => {
    const setSearchQuery = vi.spyOn(store, 'setSearchQuery');
    const setFilter = vi.spyOn(store, 'setFilter');
    const createNoteSpy = vi.spyOn(store, 'createNote').mockResolvedValue();

    // `query` is a model signal: writing it is what emits `queryChange`.
    child(SearchBoxComponent).query.set('term');
    child(FilterChipsComponent).filterChanged.emit('untriaged');
    fixture.debugElement.query(By.css('.new-note-btn')).triggerEventHandler('click');

    expect(setSearchQuery).toHaveBeenCalledWith('term');
    expect(setFilter).toHaveBeenCalledWith('untriaged');
    expect(createNoteSpy).toHaveBeenCalled();
  });

  it('disables the search shortcut while the editor overlay is open', async () => {
    // Otherwise Ctrl+K focuses a field sitting behind the modal.
    expect(child(SearchBoxComponent).shortcutEnabled()).toBe(true);

    store.openNote('note-42');
    await fixture.whenStable();

    expect(child(SearchBoxComponent).shortcutEnabled()).toBe(false);
  });

  it('delegates tag toggling from the tag rail to the store', () => {
    const toggleTag = vi.spyOn(store, 'toggleTag');

    child(TagRailComponent).tagToggled.emit('urgent');

    expect(toggleTag).toHaveBeenCalledWith('urgent');
  });

  describe('canvas', () => {
    beforeEach(async () => {
      repository.setView({
        sections: [
          // The note must sit in a section: the store resolves an opened note by
          // looking it up in the view it currently shows.
          createSection('pinned', [createNote({ id: 'note-42' })]),
          createSection('week', [], { showCreateGhost: true }),
        ],
      });
      store.reload();
      await vi.waitFor(() => expect(sections()).toHaveLength(2));
    });

    it('renders one note-section per section, forwarding the selected note id', async () => {
      store.openNote('note-42');
      await fixture.whenStable();

      expect(sections().map((s) => s.section().key)).toEqual(['pinned', 'week']);
      expect(sections().every((s) => s.selectedNoteId() === 'note-42')).toBe(true);
    });

    it('delegates note opening, create and reload requests to the store', () => {
      const openNote = vi.spyOn(store, 'openNote');
      const createNoteSpy = vi.spyOn(store, 'createNote').mockResolvedValue();

      sections()[0].noteOpened.emit('note-1');
      sections()[0].createRequested.emit();

      expect(openNote).toHaveBeenCalledWith('note-1');
      expect(createNoteSpy).toHaveBeenCalled();
    });
  });

  describe('canvas states', () => {
    it('shows a loading message instead of the sections while loading', async () => {
      // The store reports loading only until its first view lands, so this
      // needs its own fixture whose very first query stays in flight.
      TestBed.resetTestingModule();
      const held = new FakeNotesRepository([createNote({ id: 'note-42' })]);
      held.hold();
      TestBed.configureTestingModule({
        imports: [NotesPageComponent],
        providers: [provideAppTesting({ notesRepository: held, spaces: SPACES })],
      });
      const loading = TestBed.createComponent(NotesPageComponent);
      loading.autoDetectChanges();

      await vi.waitFor(() => expect(loading.nativeElement.textContent).toContain('Chargement des notes'));

      expect(loading.debugElement.queryAll(By.directive(NoteSectionComponent))).toHaveLength(0);
      expect(loading.nativeElement.querySelector('.canvas').getAttribute('aria-busy')).toBe('true');
      held.release();
    });

    it('shows an empty-search message instead of an empty results section', async () => {
      // "No results" is the backend's verdict, not something the page recomputes:
      // it reports a filtered view that matched nothing.
      repository.setView({ sections: [], isFiltering: true, matched: 0 });

      store.setFilter('pinned');
      await vi.waitFor(() =>
        expect(fixture.nativeElement.textContent).toContain('Aucune note ne correspond'),
      );

      expect(sections()).toHaveLength(0);
    });

    it('shows the load failure with its detail and offers a retry', async () => {
      // A failed load empties the whole screen, so it gets its own recovery
      // path rather than relying on the global banner alone.
      repository.failNext = new Error('database is locked');
      store.reload();
      await vi.waitFor(() =>
        expect(fixture.nativeElement.textContent).toContain('Impossible de charger les notes'),
      );

      expect(fixture.nativeElement.textContent).toContain('database is locked');
      expect(fixture.nativeElement.querySelector('.canvas-state').getAttribute('role')).toBe('alert');
      expect(sections()).toHaveLength(0);
      // The error branch comes first in the template: a failed load must not
      // also read as "still loading".
      expect(fixture.nativeElement.textContent).not.toContain('Chargement des notes');
    });

    it('reloads when the retry button is clicked', async () => {
      repository.failNext = new Error('nope');
      store.reload();
      await vi.waitFor(() => expect(fixture.nativeElement.querySelector('.canvas-retry')).not.toBeNull());
      const reload = vi.spyOn(store, 'reload').mockImplementation(() => undefined);

      fixture.debugElement.query(By.css('.canvas-retry')).triggerEventHandler('click');

      expect(reload).toHaveBeenCalled();
    });
  });

  describe('editor overlay', () => {
    it('is not rendered until a note is selected', () => {
      // The overlay never reports which note it holds — the store owns that — so
      // it simply does not exist while nothing is open, and no stray event can
      // be applied to whatever note happens to be around.
      expect(maybeChild(NoteEditorOverlayComponent)).toBeNull();
    });

    it('closes the overlay via the store when the editor overlay reports closed', async () => {
      store.openNote('note-42');
      await fixture.whenStable();
      const closeOverlay = vi.spyOn(store, 'closeOverlay');

      child(NoteEditorOverlayComponent).closed.emit();

      expect(closeOverlay).toHaveBeenCalled();
    });

    it('renames the selected note when the editor overlay reports a title change', async () => {
      store.openNote('note-42');
      await fixture.whenStable();
      const renameNote = vi.spyOn(store, 'renameNote').mockResolvedValue();

      child(NoteEditorOverlayComponent).titleChanged.emit('New title');

      expect(renameNote).toHaveBeenCalledWith('note-42', 'New title');
    });

    it('toggles the pin state of the selected note when the overlay reports pinToggled', async () => {
      store.openNote('note-42');
      await fixture.whenStable();
      const togglePinned = vi.spyOn(store, 'togglePinned').mockResolvedValue();

      child(NoteEditorOverlayComponent).pinToggled.emit();

      expect(togglePinned).toHaveBeenCalledWith('note-42');
    });

    it('applies the remaining editor changes to the selected note', async () => {
      store.openNote('note-42');
      await fixture.whenStable();
      const updateContent = vi.spyOn(store, 'updateContent').mockResolvedValue();
      const setLanguage = vi.spyOn(store, 'setLanguage').mockResolvedValue();
      const addTag = vi.spyOn(store, 'addTag').mockResolvedValue();
      const removeTag = vi.spyOn(store, 'removeTag').mockResolvedValue();
      const deleteNote = vi.spyOn(store, 'deleteNote').mockResolvedValue();
      const overlay = child(NoteEditorOverlayComponent);

      overlay.contentChanged.emit('new body');
      overlay.languageChanged.emit('json');
      overlay.tagAdded.emit('urgent');
      overlay.tagRemoved.emit('later');
      overlay.deleteRequested.emit();

      expect(updateContent).toHaveBeenCalledWith('note-42', 'new body');
      expect(setLanguage).toHaveBeenCalledWith('note-42', 'json');
      expect(addTag).toHaveBeenCalledWith('note-42', 'urgent');
      expect(removeTag).toHaveBeenCalledWith('note-42', 'later');
      expect(deleteNote).toHaveBeenCalledWith('note-42');
    });
  });
});
