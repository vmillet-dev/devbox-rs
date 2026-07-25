import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTES_REPOSITORY } from '../../../core/data/notes-repository.token';
import { NotesStore } from '../../../core/stores/notes.store';
import { MOCK_SPACES } from '../../../core/data/spaces.mock-data';
import { FakeNotesRepository } from '../../../../testing/fake-notes-repository';
import { NotesTopbarComponent } from '../components/notes-topbar/notes-topbar.component';
import { TagRailComponent } from '../components/tag-rail/tag-rail.component';
import { NoteCanvasComponent } from '../components/note-canvas/note-canvas.component';
import { NoteEditorOverlayComponent } from '../components/note-editor-overlay/note-editor-overlay.component';
import { NotesPageComponent } from './notes-page.component';

describe('NotesPageComponent', () => {
  let fixture: ComponentFixture<NotesPageComponent>;
  let store: NotesStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NotesPageComponent],
      providers: [{ provide: NOTES_REPOSITORY, useValue: new FakeNotesRepository([]) }],
    });
    fixture = TestBed.createComponent(NotesPageComponent);
    store = TestBed.inject(NotesStore);
    fixture.autoDetectChanges();
  });

  it('renders the topbar with the default active space and the store search/filter state', async () => {
    store.setSearchQuery('hello');
    store.setFilter('pinned');
    await fixture.whenStable();

    const topbar = fixture.debugElement.query(By.directive(NotesTopbarComponent)).componentInstance as NotesTopbarComponent;
    expect(topbar.spaces()).toEqual(MOCK_SPACES);
    expect(topbar.activeSpace()).toEqual(MOCK_SPACES[0]);
    expect(topbar.searchQuery()).toBe('hello');
    expect(topbar.activeFilter()).toBe('pinned');
  });

  it('updates the active space when the topbar reports a space change', async () => {
    const topbar = fixture.debugElement.query(By.directive(NotesTopbarComponent)).componentInstance as NotesTopbarComponent;

    topbar.spaceChanged.emit('work');
    await fixture.whenStable();

    expect(topbar.activeSpace()).toEqual(MOCK_SPACES[1]);
  });

  it('delegates search, filter and new-note requests from the topbar to the store', () => {
    const setSearchQuery = vi.spyOn(store, 'setSearchQuery');
    const setFilter = vi.spyOn(store, 'setFilter');
    const createDraftNote = vi.spyOn(store, 'createDraftNote');
    const topbar = fixture.debugElement.query(By.directive(NotesTopbarComponent)).componentInstance as NotesTopbarComponent;

    topbar.searchQueryChanged.emit('term');
    topbar.filterChanged.emit('untriaged');
    topbar.newNoteRequested.emit();

    expect(setSearchQuery).toHaveBeenCalledWith('term');
    expect(setFilter).toHaveBeenCalledWith('untriaged');
    expect(createDraftNote).toHaveBeenCalled();
  });

  it('delegates tag toggling from the tag rail to the store', () => {
    const toggleTag = vi.spyOn(store, 'toggleTag');
    const tagRail = fixture.debugElement.query(By.directive(TagRailComponent)).componentInstance as TagRailComponent;

    tagRail.tagToggled.emit('urgent');

    expect(toggleTag).toHaveBeenCalledWith('urgent');
  });

  it('delegates note opening and create requests from the canvas to the store', () => {
    const openNote = vi.spyOn(store, 'openNote');
    const createDraftNote = vi.spyOn(store, 'createDraftNote');
    const canvas = fixture.debugElement.query(By.directive(NoteCanvasComponent)).componentInstance as NoteCanvasComponent;

    canvas.noteOpened.emit('note-1');
    canvas.createRequested.emit();

    expect(openNote).toHaveBeenCalledWith('note-1');
    expect(createDraftNote).toHaveBeenCalled();
  });

  it('closes the overlay via the store when the editor overlay reports closed', () => {
    const closeOverlay = vi.spyOn(store, 'closeOverlay');
    const overlay = fixture.debugElement.query(By.directive(NoteEditorOverlayComponent)).componentInstance as NoteEditorOverlayComponent;

    overlay.closed.emit();

    expect(closeOverlay).toHaveBeenCalled();
  });

  it('renames the selected note when the editor overlay reports a title change', () => {
    store.openNote('note-42');
    const renameNote = vi.spyOn(store, 'renameNote');
    const overlay = fixture.debugElement.query(By.directive(NoteEditorOverlayComponent)).componentInstance as NoteEditorOverlayComponent;

    overlay.titleChanged.emit('New title');

    expect(renameNote).toHaveBeenCalledWith('note-42', 'New title');
  });

  it('does nothing on title change when no note is selected', () => {
    const renameNote = vi.spyOn(store, 'renameNote');
    const overlay = fixture.debugElement.query(By.directive(NoteEditorOverlayComponent)).componentInstance as NoteEditorOverlayComponent;

    overlay.titleChanged.emit('New title');

    expect(renameNote).not.toHaveBeenCalled();
  });

  it('toggles the pin state of the selected note when the editor overlay reports pinToggled', () => {
    store.openNote('note-42');
    const togglePinned = vi.spyOn(store, 'togglePinned');
    const overlay = fixture.debugElement.query(By.directive(NoteEditorOverlayComponent)).componentInstance as NoteEditorOverlayComponent;

    overlay.pinToggled.emit();

    expect(togglePinned).toHaveBeenCalledWith('note-42');
  });

  it('does nothing on pinToggled when no note is selected', () => {
    const togglePinned = vi.spyOn(store, 'togglePinned');
    const overlay = fixture.debugElement.query(By.directive(NoteEditorOverlayComponent)).componentInstance as NoteEditorOverlayComponent;

    overlay.pinToggled.emit();

    expect(togglePinned).not.toHaveBeenCalled();
  });

  it('falls back to the first space when the topbar reports an unknown space id', async () => {
    const topbar = fixture.debugElement.query(By.directive(NotesTopbarComponent)).componentInstance as NotesTopbarComponent;

    topbar.spaceChanged.emit('does-not-exist');
    await fixture.whenStable();

    expect(topbar.activeSpace()).toEqual(MOCK_SPACES[0]);
  });

  it('focuses the topbar search box on Ctrl/Cmd+K and prevents the default browser behavior', () => {
    const topbar = fixture.debugElement.query(By.directive(NotesTopbarComponent)).componentInstance as NotesTopbarComponent;
    const focusSearch = vi.spyOn(topbar, 'focusSearch');

    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);

    expect(focusSearch).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores keydown events that are not the search shortcut', () => {
    const topbar = fixture.debugElement.query(By.directive(NotesTopbarComponent)).componentInstance as NotesTopbarComponent;
    const focusSearch = vi.spyOn(topbar, 'focusSearch');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));

    expect(focusSearch).not.toHaveBeenCalled();
  });
});
