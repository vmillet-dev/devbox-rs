import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Space } from '@core/models/space.model';
import { NotesStore } from '@core/stores/notes.store';
import { SpacesStore } from '@core/stores/spaces.store';
import { createNote } from '@testing/note.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { NoteCanvasComponent } from '../components/note-canvas/note-canvas.component';
import { NoteEditorOverlayComponent } from '../components/note-editor-overlay/note-editor-overlay.component';
import { NotesTopbarComponent } from '../components/notes-topbar/notes-topbar.component';
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

  function child<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type)).componentInstance as T;
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NotesPageComponent],
      providers: [provideAppTesting({ notes: [createNote({ id: 'note-42' })], spaces: SPACES })],
    });
    fixture = TestBed.createComponent(NotesPageComponent);
    store = TestBed.inject(NotesStore);
    spaces = TestBed.inject(SpacesStore);
    fixture.autoDetectChanges();
    await vi.waitFor(() => expect(spaces.spaces()).toHaveLength(SPACES.length));
  });

  it('renders the topbar with the store search/filter state and the active space', async () => {
    store.setSearchQuery('hello');
    store.setFilter('pinned');
    spaces.selectSpace('work');
    await fixture.whenStable();

    const topbar = child(NotesTopbarComponent);
    expect(topbar.spaces()).toEqual(SPACES);
    expect(topbar.activeSpace()).toEqual(SPACES[1]);
    expect(topbar.searchQuery()).toBe('hello');
    expect(topbar.activeFilter()).toBe('pinned');
  });

  it('starts on "all spaces"', async () => {
    await fixture.whenStable();

    expect(child(NotesTopbarComponent).activeSpace()).toBeNull();
  });

  it('updates the active space when the topbar reports a space change', async () => {
    child(NotesTopbarComponent).spaceChanged.emit('work');
    await fixture.whenStable();

    expect(child(NotesTopbarComponent).activeSpace()).toEqual(SPACES[1]);
  });

  it('goes back to "all spaces" when the topbar reports a null space', async () => {
    child(NotesTopbarComponent).spaceChanged.emit('work');
    await fixture.whenStable();

    child(NotesTopbarComponent).spaceChanged.emit(null);
    await fixture.whenStable();

    expect(child(NotesTopbarComponent).activeSpace()).toBeNull();
  });

  it('creates a space when the topbar reports one', () => {
    const createSpace = vi.spyOn(spaces, 'createSpace').mockResolvedValue(null);

    child(NotesTopbarComponent).spaceCreated.emit('Side project');

    expect(createSpace).toHaveBeenCalledWith('Side project');
  });

  it('delegates search, filter and new-note requests from the topbar to the store', () => {
    const setSearchQuery = vi.spyOn(store, 'setSearchQuery');
    const setFilter = vi.spyOn(store, 'setFilter');
    const createNoteSpy = vi.spyOn(store, 'createNote').mockResolvedValue();
    const topbar = child(NotesTopbarComponent);

    topbar.searchQueryChanged.emit('term');
    topbar.filterChanged.emit('untriaged');
    topbar.newNoteRequested.emit();

    expect(setSearchQuery).toHaveBeenCalledWith('term');
    expect(setFilter).toHaveBeenCalledWith('untriaged');
    expect(createNoteSpy).toHaveBeenCalled();
  });

  it('disables the search shortcut while the editor overlay is open', async () => {
    // Otherwise Ctrl+K focuses a field sitting behind the modal.
    expect(child(NotesTopbarComponent).searchShortcutEnabled()).toBe(true);

    store.openNote('note-42');
    await fixture.whenStable();

    expect(child(NotesTopbarComponent).searchShortcutEnabled()).toBe(false);
  });

  it('delegates tag toggling from the tag rail to the store', () => {
    const toggleTag = vi.spyOn(store, 'toggleTag');

    child(TagRailComponent).tagToggled.emit('urgent');

    expect(toggleTag).toHaveBeenCalledWith('urgent');
  });

  it('delegates note opening, create and reload requests from the canvas to the store', () => {
    const openNote = vi.spyOn(store, 'openNote');
    const createNoteSpy = vi.spyOn(store, 'createNote').mockResolvedValue();
    const reload = vi.spyOn(store, 'reload').mockImplementation(() => undefined);
    const canvas = child(NoteCanvasComponent);

    canvas.noteOpened.emit('note-1');
    canvas.createRequested.emit();
    canvas.reloadRequested.emit();

    expect(openNote).toHaveBeenCalledWith('note-1');
    expect(createNoteSpy).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it('passes the store loading and empty-result state to the canvas', async () => {
    store.setSearchQuery('nothing matches this');
    await fixture.whenStable();

    expect(child(NoteCanvasComponent).hasNoResults()).toBe(true);
    expect(child(NoteCanvasComponent).isLoading()).toBe(false);
  });

  it('closes the overlay via the store when the editor overlay reports closed', () => {
    const closeOverlay = vi.spyOn(store, 'closeOverlay');

    child(NoteEditorOverlayComponent).closed.emit();

    expect(closeOverlay).toHaveBeenCalled();
  });

  it('renames the selected note when the editor overlay reports a title change', () => {
    store.openNote('note-42');
    const renameNote = vi.spyOn(store, 'renameNote').mockResolvedValue();

    child(NoteEditorOverlayComponent).titleChanged.emit('New title');

    expect(renameNote).toHaveBeenCalledWith('note-42', 'New title');
  });

  it('does nothing on title change when no note is selected', () => {
    const renameNote = vi.spyOn(store, 'renameNote').mockResolvedValue();

    child(NoteEditorOverlayComponent).titleChanged.emit('New title');

    expect(renameNote).not.toHaveBeenCalled();
  });

  it('toggles the pin state of the selected note when the editor overlay reports pinToggled', () => {
    store.openNote('note-42');
    const togglePinned = vi.spyOn(store, 'togglePinned').mockResolvedValue();

    child(NoteEditorOverlayComponent).pinToggled.emit();

    expect(togglePinned).toHaveBeenCalledWith('note-42');
  });

  it('does nothing on pinToggled when no note is selected', () => {
    const togglePinned = vi.spyOn(store, 'togglePinned').mockResolvedValue();

    child(NoteEditorOverlayComponent).pinToggled.emit();

    expect(togglePinned).not.toHaveBeenCalled();
  });

  it('applies the remaining editor changes to the selected note', () => {
    store.openNote('note-42');
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

  it('ignores editor changes when no note is selected', () => {
    // The overlay never reports which note it holds — the store owns that — so
    // a stray event must not be applied to whatever note happens to be around.
    const updateContent = vi.spyOn(store, 'updateContent').mockResolvedValue();
    const deleteNote = vi.spyOn(store, 'deleteNote').mockResolvedValue();
    const overlay = child(NoteEditorOverlayComponent);

    overlay.contentChanged.emit('new body');
    overlay.deleteRequested.emit();

    expect(updateContent).not.toHaveBeenCalled();
    expect(deleteNote).not.toHaveBeenCalled();
  });
});
