import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Provider } from '@angular/core';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_SUBSCRIBER, EventSubscriber, GlobalAction } from '@core/ipc/app-events.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { StatusNotifier } from '@core/notifications/status.service';
import { FILE_DROP_SUBSCRIBER, FileDropSubscriber } from '@core/window/file-drop.service';
import { Note } from './model/note.model';
import { Space } from './model/space.model';
import { AttachmentsStore } from './state/attachments.store';
import { NoteSelectionStore } from './state/note-selection.store';
import { NotesQueryStore } from './state/notes-query.store';
import { NotesStore } from './state/notes.store';
import { PaletteStore } from './state/palette.store';
import { PlaceholderFillStore } from './state/placeholder-fill.store';
import { SpacesStore } from './state/spaces.store';
import { TagsStore } from './state/tags.store';
import { TrashStore } from './state/trash.store';
import { FakeAppWindow } from '@testing/fake-app-window';
import { FakeAttachmentsRepository } from '@testing/fake-attachments-repository';
import { FakeClipboard } from '@testing/fake-clipboard';
import { FakeFileDialog } from '@testing/fake-file-dialog';
import { FakeNotesRepository } from '@testing/fake-notes-repository';
import { FakeTransferRepository } from '@testing/fake-transfer-repository';
import { createNote } from '@testing/note.fixture';
import { createSection } from '@testing/section.fixture';
import { provideAppTesting } from '@testing/testing.providers';
import { FilterChipsComponent } from './ui/filter-chips/filter-chips.component';
import { ImageLightboxComponent } from './ui/image-lightbox/image-lightbox.component';
import { NoteEditorOverlayComponent } from './ui/note-editor-overlay/note-editor-overlay.component';
import { NoteSectionComponent } from './ui/note-section/note-section.component';
import { PlaceholderFormComponent } from './ui/placeholder-form/placeholder-form.component';
import { QuickPaletteComponent } from './ui/quick-palette/quick-palette.component';
import { SearchBoxComponent } from './ui/search-box/search-box.component';
import { SelectionBarComponent } from './ui/selection-bar/selection-bar.component';
import { SpaceSwitcherComponent } from './ui/space-switcher/space-switcher.component';
import { TagManagerComponent } from './ui/tag-manager/tag-manager.component';
import { TagRailComponent } from './ui/tag-rail/tag-rail.component';
import { TrashPanelComponent } from './ui/trash-panel/trash-panel.component';
import { NotesPageComponent } from './notes-page.component';

const SPACES: readonly Space[] = [
  { id: 'space-1', name: 'Space one' },
  { id: 'work', name: 'Work' },
];

describe('NotesPageComponent', () => {
  let fixture: ComponentFixture<NotesPageComponent>;
  let store: NotesStore;
  let canvas: NotesQueryStore;
  let selection: NoteSelectionStore;
  let spaces: SpacesStore;
  let repository: FakeNotesRepository;
  let attachmentsRepository: FakeAttachmentsRepository;
  let transferRepository: FakeTransferRepository;
  let fileDialog: FakeFileDialog;
  let clipboard: FakeClipboard;
  let appWindow: FakeAppWindow;

  /** Native pushes the page subscribes to; the spec fires them by hand. */
  let fireAction: (action: GlobalAction) => void;
  let actionHandler: ((action: GlobalAction) => void) | null;
  /** The window-level file drop, which never reaches the DOM. */
  let dropFiles: (paths: readonly string[]) => void;

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

  /** A keystroke on the document, which is where the page listens. */
  function press(key: string, init: KeyboardEventInit = {}): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  }

  /**
   * Both native seams are substituted rather than left to fail under jsdom: a global
   * shortcut and a file drop are only observable by firing them.
   */
  async function setUp(notes: readonly Note[] = [createNote({ id: 'note-42' })]): Promise<void> {
    TestBed.resetTestingModule();
    repository = new FakeNotesRepository(notes);
    attachmentsRepository = new FakeAttachmentsRepository();
    transferRepository = new FakeTransferRepository();
    fileDialog = new FakeFileDialog();
    actionHandler = null;
    clipboard = new FakeClipboard();
    appWindow = new FakeAppWindow();

    const subscribe: EventSubscriber = async (handler) => {
      actionHandler = handler;
      return () => (actionHandler = null);
    };
    fireAction = (action) => actionHandler?.(action);

    let dropHandler: ((paths: readonly string[]) => void) | null = null;
    const subscribeDrops: FileDropSubscriber = async (handler) => {
      dropHandler = handler;
      return () => (dropHandler = null);
    };
    dropFiles = (paths) => dropHandler?.(paths);

    const providers: Provider[] = [
      provideAppTesting({
        notesRepository: repository,
        spaces: SPACES,
        attachmentsRepository,
        transferRepository,
        fileDialog,
        clipboard,
        appWindow,
      }),
      { provide: EVENT_SUBSCRIBER, useValue: subscribe },
      { provide: FILE_DROP_SUBSCRIBER, useValue: subscribeDrops },
    ];

    TestBed.configureTestingModule({ imports: [NotesPageComponent], providers });
    fixture = TestBed.createComponent(NotesPageComponent);
    store = TestBed.inject(NotesStore);
    canvas = TestBed.inject(NotesQueryStore);
    selection = TestBed.inject(NoteSelectionStore);
    spaces = TestBed.inject(SpacesStore);
    fixture.autoDetectChanges();
    await vi.waitFor(() => expect(spaces.spaces()).toHaveLength(SPACES.length));
    await vi.waitFor(() => expect(actionHandler).not.toBeNull());
  }

  beforeEach(async () => {
    await setUp();
  });

  it('renders the toolbar with the store search/filter state and the active space', async () => {
    canvas.setSearchQuery('hello');
    canvas.setFilter('pinned');
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

  it('renames a space without touching the canvas', async () => {
    const queries = repository.queryCount;

    child(SpaceSwitcherComponent).spaceRenamed.emit({ id: 'work', name: 'Client work' });
    await vi.waitFor(() => expect(spaces.spaces()[1].name).toBe('Client work'));

    expect(repository.queryCount).toBe(queries);
  });

  it('reloads the canvas once a deleted space has handed its notes over', async () => {
    const queries = repository.queryCount;

    child(SpaceSwitcherComponent).spaceDeleted.emit({ id: 'work', targetSpaceId: 'space-1' });

    await vi.waitFor(() => expect(spaces.spaces()).toHaveLength(1));
    await vi.waitFor(() => expect(repository.queryCount).toBeGreaterThan(queries));
  });

  it('leaves the canvas alone when the space deletion failed', async () => {
    const queries = repository.queryCount;
    vi.spyOn(spaces, 'deleteSpace').mockResolvedValue(false);

    child(SpaceSwitcherComponent).spaceDeleted.emit({ id: 'work', targetSpaceId: 'space-1' });
    await fixture.whenStable();

    expect(repository.queryCount).toBe(queries);
  });

  it('delegates search, filter and new-note requests to the store', () => {
    const setSearchQuery = vi.spyOn(canvas, 'setSearchQuery');
    const setFilter = vi.spyOn(canvas, 'setFilter');
    const createNoteSpy = vi.spyOn(store, 'createNote').mockResolvedValue();

    child(SearchBoxComponent).query.set('term');
    child(FilterChipsComponent).filterChanged.emit('untriaged');
    fixture.debugElement.query(By.css('.new-note-btn')).triggerEventHandler('click');

    expect(setSearchQuery).toHaveBeenCalledWith('term');
    expect(setFilter).toHaveBeenCalledWith('untriaged');
    expect(createNoteSpy).toHaveBeenCalled();
  });

  it('disables the search shortcut while the editor overlay is open', async () => {
    expect(child(SearchBoxComponent).shortcutEnabled()).toBe(true);

    store.openNote('note-42');
    await fixture.whenStable();

    expect(child(SearchBoxComponent).shortcutEnabled()).toBe(false);
  });

  it('delegates tag toggling from the tag rail to the store', () => {
    const toggleTag = vi.spyOn(canvas, 'toggleTag');

    child(TagRailComponent).tagToggled.emit('urgent');

    expect(toggleTag).toHaveBeenCalledWith('urgent');
  });

  describe('canvas', () => {
    beforeEach(async () => {
      repository.setView({
        sections: [
          createSection('pinned', [createNote({ id: 'note-42' })]),
          createSection('week', [], { showCreateGhost: true }),
        ],
      });
      canvas.reload();
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

      sections()[0].noteOpened.emit({ noteId: 'note-1', toggleChecked: false, extendRange: false });
      sections()[0].createRequested.emit();

      expect(openNote).toHaveBeenCalledWith('note-1');
      expect(createNoteSpy).toHaveBeenCalled();
    });

    it('checks a note instead of opening it when the card reports a modified click', () => {
      const openNote = vi.spyOn(store, 'openNote');

      sections()[0].noteOpened.emit({ noteId: 'note-42', toggleChecked: true, extendRange: false });

      expect(selection.checkedIds().has('note-42')).toBe(true);
      expect(selection.focusedNoteId()).toBe('note-42');
      expect(openNote).not.toHaveBeenCalled();
    });

    it('extends the checked range when the card reports a shift click', () => {
      const checkRangeTo = vi.spyOn(selection, 'checkRangeTo');
      const toggleChecked = vi.spyOn(selection, 'toggleChecked');

      sections()[0].noteOpened.emit({ noteId: 'note-42', toggleChecked: true, extendRange: true });

      expect(checkRangeTo).toHaveBeenCalledWith('note-42');
      expect(toggleChecked).not.toHaveBeenCalled();
    });

    it('moves and deletes a note straight from its card', async () => {
      const moveNote = vi.spyOn(store, 'moveNote').mockResolvedValue();
      const deleteNote = vi.spyOn(store, 'deleteNote').mockResolvedValue();

      sections()[0].noteMoved.emit({ noteId: 'note-42', spaceId: 'work' });
      sections()[0].noteDeleted.emit('note-42');
      sections()[0].noteChecked.emit('note-42');

      expect(moveNote).toHaveBeenCalledWith('note-42', 'work');
      expect(deleteNote).toHaveBeenCalledWith('note-42');
      expect(selection.checkedIds().has('note-42')).toBe(true);
    });
  });

  describe('canvas states', () => {
    it('shows a loading message instead of the sections while loading', async () => {
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
      repository.setView({ sections: [], isFiltering: true, matched: 0 });

      canvas.setFilter('pinned');
      await vi.waitFor(() =>
        expect(fixture.nativeElement.textContent).toContain('Aucune note ne correspond'),
      );

      expect(sections()).toHaveLength(0);
    });

    it('shows the load failure with its detail and offers a retry', async () => {
      repository.failNext = new Error('database is locked');
      canvas.reload();
      await vi.waitFor(() =>
        expect(fixture.nativeElement.textContent).toContain('Impossible de charger les notes'),
      );

      expect(fixture.nativeElement.textContent).toContain('database is locked');
      expect(fixture.nativeElement.querySelector('.canvas-state').getAttribute('role')).toBe('alert');
      expect(sections()).toHaveLength(0);
      expect(fixture.nativeElement.textContent).not.toContain('Chargement des notes');
    });

    it('reloads when the retry button is clicked', async () => {
      repository.failNext = new Error('nope');
      canvas.reload();
      await vi.waitFor(() => expect(fixture.nativeElement.querySelector('.canvas-retry')).not.toBeNull());
      const reload = vi.spyOn(canvas, 'reload').mockImplementation(() => undefined);

      fixture.debugElement.query(By.css('.canvas-retry')).triggerEventHandler('click');

      expect(reload).toHaveBeenCalled();
    });
  });

  describe('editor overlay', () => {
    it('is not rendered until a note is selected', () => {
      expect(maybeChild(NoteEditorOverlayComponent)).toBeNull();
    });

    it('closes the overlay via the store when the editor overlay reports closed', async () => {
      store.openNote('note-42');
      await fixture.whenStable();
      const closeOverlay = vi.spyOn(store, 'closeOverlay');

      child(NoteEditorOverlayComponent).closed.emit();

      expect(closeOverlay).toHaveBeenCalled();
    });

    /** The page names no field: the editor says what changed, the page on which note. */
    it('hands every editor change to the store as a patch on the open note', async () => {
      store.openNote('note-42');
      await fixture.whenStable();
      const applyPatch = vi.spyOn(store, 'applyPatch').mockResolvedValue();
      const overlay = child(NoteEditorOverlayComponent);
      const deadline = { kind: 'expires', at: new Date('2026-03-01T22:59:59.999Z') } as const;

      overlay.patchRequested.emit({ title: 'New title' });
      overlay.patchRequested.emit({ content: 'new body', language: 'json' });
      overlay.patchRequested.emit({ lifecycle: deadline, tags: ['urgent'] });

      expect(applyPatch.mock.calls).toEqual([
        ['note-42', { title: 'New title' }],
        ['note-42', { content: 'new body', language: 'json' }],
        ['note-42', { lifecycle: deadline, tags: ['urgent'] }],
      ]);
    });

    it('deletes the selected note when the overlay asks', async () => {
      store.openNote('note-42');
      await fixture.whenStable();
      const deleteNote = vi.spyOn(store, 'deleteNote').mockResolvedValue();

      child(NoteEditorOverlayComponent).deleteRequested.emit();

      expect(deleteNote).toHaveBeenCalledWith('note-42');
    });
  });

  describe('native shortcuts', () => {
    it('captures the clipboard into a saved note when the capture event fires', async () => {
      clipboard.content = 'psql -h localhost';

      fireAction('capture');

      await vi.waitFor(() => expect(store.selectedNote()?.content).toBe('psql -h localhost'));
    });

    it('opens an unsaved draft when the new-note event fires', async () => {
      fireAction('new-note');
      await fixture.whenStable();

      expect(store.selectedNote()?.content).toBe('');
      expect(store.persistedNoteId()).toBeNull();
    });

    it('opens the quick palette when the palette event fires', async () => {
      fireAction('palette');

      await vi.waitFor(() => expect(maybeChild(QuickPaletteComponent)).not.toBeNull());
    });
  });

  describe('bulk actions', () => {
    it('copies the checked notes as markdown from the selection bar', async () => {
      selection.toggleChecked('note-42');
      await fixture.whenStable();

      child(SelectionBarComponent).copyRequested.emit();

      await vi.waitFor(() => expect(transferRepository.sharedIds).toEqual(['note-42']));
    });
  });

  describe('keyboard navigation', () => {
    const cards = ['n1', 'n2', 'n3', 'n4'].map((id) => createNote({ id, content: `body of ${id}` }));

    beforeEach(async () => {
      await setUp(cards);
      await vi.waitFor(() => expect(canvas.visibleNotes()).toHaveLength(4));
    });

    it('enters the grid on the first card when nothing is focused yet', () => {
      press('ArrowRight');

      expect(selection.focusedNoteId()).toBe('n1');
    });

    it('walks the cards with the left and right arrows, stopping at both ends', () => {
      selection.focusNote('n1');

      press('ArrowRight');
      expect(selection.focusedNoteId()).toBe('n2');

      press('ArrowLeft');
      press('ArrowLeft');
      expect(selection.focusedNoteId()).toBe('n1');
    });

    it('measures the cards to move between rows', () => {
      const shells = fixture.nativeElement.querySelectorAll('.card-shell') as NodeListOf<HTMLElement>;
      shells.forEach((shell, index) => {
        const rect = new DOMRect(index % 2 === 0 ? 0 : 300, index < 2 ? 0 : 200, 240, 160);
        vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(rect);
      });
      selection.focusNote('n2');

      press('ArrowDown');
      expect(selection.focusedNoteId()).toBe('n4');

      press('ArrowUp');
      expect(selection.focusedNoteId()).toBe('n2');
    });

    it('opens the focused note on Enter', () => {
      selection.focusNote('n3');

      press('Enter');

      expect(store.selectedNoteId()).toBe('n3');
    });

    it('checks and unchecks the focused note on x', () => {
      selection.focusNote('n2');

      press('x');
      expect(selection.checkedIds().has('n2')).toBe(true);

      press('X');
      expect(selection.checkedIds().has('n2')).toBe(false);
    });

    it('copies the focused note on c', async () => {
      selection.focusNote('n2');

      press('c');

      await vi.waitFor(() => expect(clipboard.content).toBe('body of n2'));
    });

    it('reports a copy the clipboard refused', async () => {
      selection.focusNote('n2');
      clipboard.failNext = new Error('no clipboard');

      press('c');

      await vi.waitFor(() =>
        expect(TestBed.inject(ErrorNotifier).notice()?.ref.key).toBe('errors.copyFailed'),
      );
    });

    it('pins the focused note on p', async () => {
      selection.focusNote('n1');

      press('p');

      await vi.waitFor(() => expect(canvas.visibleNotes().find((n) => n.id === 'n1')?.pinned).toBe(true));
    });

    it('trashes the focused note on Delete, offering to take it back', async () => {
      selection.focusNote('n1');

      press('Delete');

      await vi.waitFor(() => expect(store.lastDeletion()).toEqual({ ids: ['n1'], count: 1 }));
      expect(canvas.visibleNotes().map((note) => note.id)).not.toContain('n1');
    });

    it('takes back the last deletion on Ctrl+Z', async () => {
      selection.focusNote('n1');
      press('Backspace');
      await vi.waitFor(() => expect(store.lastDeletion()).not.toBeNull());

      press('z', { ctrlKey: true });

      await vi.waitFor(() => expect(canvas.visibleNotes().map((note) => note.id)).toContain('n1'));
      expect(store.lastDeletion()).toBeNull();
    });

    it('leaves Ctrl+Z alone when nothing was deleted', () => {
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('clears the checked notes on Escape', () => {
      selection.toggleChecked('n1');
      selection.toggleChecked('n2');

      press('Escape');

      expect(selection.checkedIds().size).toBe(0);
    });

    it('ignores the canvas keys while typing in a field', () => {
      selection.focusNote('n1');
      const input = document.createElement('input');
      document.body.appendChild(input);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));

      expect(selection.checkedIds().size).toBe(0);
      input.remove();
    });

    it('ignores the canvas keys while a modal holds the keyboard', async () => {
      store.openNote('n1');
      await fixture.whenStable();
      selection.focusNote('n2');

      press('x');

      expect(selection.checkedIds().size).toBe(0);
    });

    it('ignores a chord it does not own', () => {
      selection.focusNote('n1');

      press('x', { altKey: true });

      expect(selection.checkedIds().size).toBe(0);
    });
  });

  describe('attachments', () => {
    beforeEach(async () => {
      store.openNote('note-42');
      await fixture.whenStable();
      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).attachments()).toEqual([]));
    });

    it('attaches the file the picker returned', async () => {
      fileDialog.openPath = 'C:\\shots\\capture.png';

      void TestBed.inject(AttachmentsStore).addFromPicker();

      await vi.waitFor(() =>
        expect(
          TestBed.inject(AttachmentsStore)
            .attachments()
            .map((a) => a.fileName),
        ).toEqual(['capture.png']),
      );
    });

    it('saves an unsaved draft first, since a file needs a row to hang on', async () => {
      store.createNote();
      await fixture.whenStable();
      expect(store.persistedNoteId()).toBeNull();
      fileDialog.openPath = 'C:\\shots\\capture.png';

      void TestBed.inject(AttachmentsStore).addFromPicker();

      await vi.waitFor(() => expect(store.persistedNoteId()).not.toBeNull());
      await vi.waitFor(() =>
        expect(
          TestBed.inject(AttachmentsStore)
            .attachments()
            .map((a) => a.fileName),
        ).toEqual(['capture.png']),
      );
    });

    it('attaches every file dropped on the window', async () => {
      dropFiles(['C:\\a.png', 'C:\\b.png']);

      await vi.waitFor(() =>
        expect(
          TestBed.inject(AttachmentsStore)
            .attachments()
            .map((a) => a.fileName),
        ).toEqual(['a.png', 'b.png']),
      );
    });

    it('ignores a drop while no note is open to receive it', async () => {
      store.closeOverlay();
      await fixture.whenStable();

      dropFiles(['C:\\a.png']);
      await fixture.whenStable();

      expect(TestBed.inject(AttachmentsStore).attachments()).toEqual([]);
    });

    it('ignores an empty drop', async () => {
      dropFiles([]);
      await fixture.whenStable();

      expect(TestBed.inject(AttachmentsStore).attachments()).toEqual([]);
    });

    it('attaches the clipboard image on paste', async () => {
      void TestBed.inject(AttachmentsStore).addPastedImage();

      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).attachments()).toHaveLength(1));
    });

    it('says so when the pasted clipboard carried no image after all', async () => {
      attachmentsRepository.failNext = new Error('no image in clipboard');

      void TestBed.inject(AttachmentsStore).addPastedImage();

      await vi.waitFor(() =>
        expect(TestBed.inject(ErrorNotifier).notice()?.ref.key).toBe('attachments.pasteEmpty'),
      );
    });

    it('announces where an attachment was saved', async () => {
      fileDialog.openPath = 'C:\\shots\\capture.png';
      void TestBed.inject(AttachmentsStore).addFromPicker();
      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).attachments()).toHaveLength(1));
      const id = TestBed.inject(AttachmentsStore).attachments()[0].id;
      fileDialog.savePath = 'D:\\keep\\capture.png';

      void TestBed.inject(AttachmentsStore).saveToDisk(id);

      await vi.waitFor(() =>
        expect(TestBed.inject(StatusNotifier).status()).toEqual({
          key: 'attachments.saved',
          params: { path: 'D:\\keep\\capture.png' },
        }),
      );
    });

    it('says nothing when the save dialog was dismissed', async () => {
      fileDialog.openPath = 'C:\\shots\\capture.png';
      void TestBed.inject(AttachmentsStore).addFromPicker();
      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).attachments()).toHaveLength(1));
      TestBed.inject(StatusNotifier).dismiss();

      void TestBed.inject(AttachmentsStore).saveToDisk(TestBed.inject(AttachmentsStore).attachments()[0].id);
      await fixture.whenStable();

      expect(TestBed.inject(StatusNotifier).status()).toBeNull();
    });

    it('closes the zoomed view along with the preview it shows', async () => {
      fileDialog.openPath = 'C:\\shots\\capture.png';
      void TestBed.inject(AttachmentsStore).addFromPicker();
      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).previewData()).not.toBeNull());
      const id = TestBed.inject(AttachmentsStore).previewId()!;

      TestBed.inject(AttachmentsStore).zoom();
      await vi.waitFor(() => expect(maybeChild(ImageLightboxComponent)).not.toBeNull());

      void TestBed.inject(AttachmentsStore).togglePreview(id);
      await vi.waitFor(() => expect(maybeChild(ImageLightboxComponent)).toBeNull());
    });
  });

  describe('{{fields}}', () => {
    const snippet = createNote({
      id: 'snippet',
      content: 'psql -h {{host}} -p {{port}}',
      placeholders: [
        { name: 'host', defaultValue: '', value: '' },
        { name: 'port', defaultValue: '5432', value: '' },
      ],
    });

    beforeEach(async () => {
      await setUp([snippet]);
      await vi.waitFor(() => expect(sections()).toHaveLength(1));
    });

    it('opens the field form for the note the card points at', async () => {
      sections()[0].fillRequested.emit('snippet');
      await fixture.whenStable();

      expect(child(PlaceholderFormComponent).placeholders()).toEqual(snippet.placeholders);
    });

    it('ignores a fill asked for a note that is no longer on screen', async () => {
      sections()[0].fillRequested.emit('vanished');
      await fixture.whenStable();

      expect(maybeChild(PlaceholderFormComponent)).toBeNull();
    });

    it('fills the fields, then copies the result', async () => {
      sections()[0].fillRequested.emit('snippet');
      await fixture.whenStable();

      child(PlaceholderFormComponent).submitted.emit({ host: 'db.internal', port: '5432' });

      await vi.waitFor(() => expect(clipboard.content).toBe('psql -h db.internal -p 5432'));
      expect(maybeChild(PlaceholderFormComponent)).toBeNull();
    });

    it('keeps what was typed, so the next copy does not ask again', async () => {
      sections()[0].fillRequested.emit('snippet');
      await fixture.whenStable();

      child(PlaceholderFormComponent).submitted.emit({ host: 'db.internal', port: '' });
      await vi.waitFor(() => expect(canvas.visibleNotes()[0].placeholders[0].value).toBe('db.internal'));

      sections()[0].fillRequested.emit('snippet');
      await fixture.whenStable();
      expect(child(PlaceholderFormComponent).placeholders()[0].value).toBe('db.internal');
    });

    it('saves the values from the editor panel without touching the note', async () => {
      store.openNote('snippet');
      await fixture.whenStable();

      child(NoteEditorOverlayComponent).placeholderValuesChanged.emit({ host: 'db.internal' });

      await vi.waitFor(() => expect(store.selectedNote()?.placeholders[0].value).toBe('db.internal'));
    });

    it('fills the editor preview and hands the text back to the overlay', async () => {
      store.openNote('snippet');
      await fixture.whenStable();

      void TestBed.inject(PlaceholderFillStore).refreshPreview({
        content: 'psql -h {{host}}',
        values: { host: 'db.internal' },
      });

      await vi.waitFor(() =>
        expect(TestBed.inject(PlaceholderFillStore).preview()).toBe('psql -h db.internal'),
      );
    });

    it('copies the filled body from the editor and says so', async () => {
      store.openNote('snippet');
      await fixture.whenStable();

      void TestBed.inject(PlaceholderFillStore).copyFilled({
        content: 'psql -h {{host}}',
        values: { host: 'db.internal' },
      });

      await vi.waitFor(() => expect(clipboard.content).toBe('psql -h db.internal'));
      expect(TestBed.inject(StatusNotifier).status()?.key).toBe('placeholders.copiedFilled');
    });

    it('says nothing when the clipboard refuses the filled copy', async () => {
      store.openNote('snippet');
      await fixture.whenStable();
      clipboard.failNext = new Error('no clipboard');

      void TestBed.inject(PlaceholderFillStore).copyFilled({
        content: 'psql -h {{host}}',
        values: { host: 'db.internal' },
      });

      await vi.waitFor(() =>
        expect(TestBed.inject(ErrorNotifier).notice()?.ref.key).toBe('errors.copyFailed'),
      );
      expect(TestBed.inject(StatusNotifier).status()).toBeNull();
    });

    it('copies the snippet untouched when the raw option is taken', async () => {
      sections()[0].fillRequested.emit('snippet');
      await fixture.whenStable();

      child(PlaceholderFormComponent).rawRequested.emit();

      await vi.waitFor(() => expect(clipboard.content).toBe(snippet.content));
      await fixture.whenStable();
      expect(maybeChild(PlaceholderFormComponent)).toBeNull();
    });

    it('copies nothing when the form is cancelled', async () => {
      sections()[0].fillRequested.emit('snippet');
      await fixture.whenStable();

      child(PlaceholderFormComponent).cancelled.emit();
      await fixture.whenStable();

      expect(clipboard.content).toBe('');
      expect(maybeChild(PlaceholderFormComponent)).toBeNull();
    });
  });

  describe('quick palette', () => {
    let palette: PaletteStore;

    beforeEach(async () => {
      palette = TestBed.inject(PaletteStore);
      await palette.open();
      await fixture.whenStable();
    });

    it('turns what was typed on the create row into a saved note', async () => {
      palette.setQuery('kubectl get pods -A');
      palette.highlight(palette.results().length);
      await fixture.whenStable();

      child(QuickPaletteComponent).chosen.emit();

      await vi.waitFor(() => expect(store.selectedNote()?.content).toBe('kubectl get pods -A'));
      expect(palette.isOpen()).toBe(false);
    });

    it('copies the highlighted snippet and steps out of the way', async () => {
      child(QuickPaletteComponent).chosen.emit();

      await vi.waitFor(() => expect(clipboard.content).toBe('line one\nline two'));
      await vi.waitFor(() => expect(appWindow.hidden).toBe(1));
      expect(palette.isOpen()).toBe(false);
    });

    it('opens the highlighted note in the editor instead, closing the palette', async () => {
      child(QuickPaletteComponent).openRequested.emit('note-42');
      await fixture.whenStable();

      expect(palette.isOpen()).toBe(false);
      expect(store.selectedNoteId()).toBe('note-42');
    });

    it('sends a snippet with fields through the form before copying it', async () => {
      await setUp([
        createNote({
          id: 'snippet',
          content: 'ssh {{user}}@host',
          placeholders: [{ name: 'user', defaultValue: '', value: '' }],
        }),
      ]);
      palette = TestBed.inject(PaletteStore);
      await palette.open();
      await vi.waitFor(() => expect(palette.results()).toHaveLength(1));
      await fixture.whenStable();

      child(QuickPaletteComponent).chosen.emit();
      await vi.waitFor(() => expect(maybeChild(PlaceholderFormComponent)).not.toBeNull());
      child(PlaceholderFormComponent).submitted.emit({ user: 'root' });

      await vi.waitFor(() => expect(clipboard.content).toBe('ssh root@host'));
    });
  });

  describe('trash and tag management', () => {
    beforeEach(async () => {
      await setUp([createNote({ id: 'n1', tags: ['auth'] }), createNote({ id: 'n2', tags: ['auth'] })]);
      await vi.waitFor(() => expect(canvas.visibleNotes()).toHaveLength(2));
    });

    it('brings a restored note back to the canvas', async () => {
      await store.deleteNote('n1');
      await TestBed.inject(TrashStore).open();
      await vi.waitFor(() => expect(maybeChild(TrashPanelComponent)).not.toBeNull());

      child(TrashPanelComponent).restoreRequested.emit('n1');

      await vi.waitFor(() => expect(canvas.visibleNotes().map((note) => note.id)).toContain('n1'));
    });

    it('closes the trash panel without re-querying, since nothing changed', async () => {
      await TestBed.inject(TrashStore).open();
      await fixture.whenStable();
      const queries = repository.queryCount;

      child(TrashPanelComponent).closed.emit();
      await fixture.whenStable();

      expect(TestBed.inject(TrashStore).isOpen()).toBe(false);
      expect(repository.queryCount).toBe(queries);
    });

    it('renames a tag across the corpus and reloads', async () => {
      await TestBed.inject(TagsStore).open();
      await vi.waitFor(() => expect(maybeChild(TagManagerComponent)).not.toBeNull());
      child(TagManagerComponent).toggled.emit('auth');
      await fixture.whenStable();

      child(TagManagerComponent).renameRequested.emit('authentication');

      await vi.waitFor(() => expect(repository.retagged).toEqual({ tags: ['auth'], into: 'authentication' }));
      await vi.waitFor(() => expect(canvas.allTags()).toEqual(['authentication']));
    });

    it('drops the selected tags from the corpus and reloads', async () => {
      await TestBed.inject(TagsStore).open();
      await vi.waitFor(() => expect(maybeChild(TagManagerComponent)).not.toBeNull());
      child(TagManagerComponent).toggled.emit('auth');
      await fixture.whenStable();

      child(TagManagerComponent).deleteRequested.emit();

      await vi.waitFor(() => expect(repository.deletedTags).toEqual(['auth']));
      await vi.waitFor(() => expect(canvas.allTags()).toEqual([]));
    });

    it('leaves the canvas alone when the tag action changed nothing', async () => {
      await TestBed.inject(TagsStore).open();
      await vi.waitFor(() => expect(maybeChild(TagManagerComponent)).not.toBeNull());
      const queries = repository.queryCount;

      child(TagManagerComponent).renameRequested.emit('authentication');
      await fixture.whenStable();

      expect(repository.queryCount).toBe(queries);
    });
  });
});
