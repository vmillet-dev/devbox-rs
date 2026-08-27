import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Provider } from '@angular/core';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppEventTopic, EVENT_SUBSCRIBER, EventSubscriber } from '@core/ipc/app-events.service';
import { AppMenuRegistry } from '@core/menu/app-menu.registry';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { StatusNotifier } from '@core/notifications/status.service';
import { FILE_DROP_SUBSCRIBER, FileDropSubscriber } from '@core/window/file-drop.service';
import { Note } from './model/note.model';
import { Space } from './model/space.model';
import { AttachmentsStore } from './state/attachments.store';
import { NotesStore } from './state/notes.store';
import { PaletteStore } from './state/palette.store';
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
  let spaces: SpacesStore;
  let repository: FakeNotesRepository;
  let attachmentsRepository: FakeAttachmentsRepository;
  let transferRepository: FakeTransferRepository;
  let fileDialog: FakeFileDialog;
  let clipboard: FakeClipboard;
  let appWindow: FakeAppWindow;
  let menu: AppMenuRegistry;

  /** Native pushes the page subscribes to; the spec fires them by hand. */
  let fireEvent: (topic: AppEventTopic) => void;
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
   * Builds the page over fresh doubles. Both native seams are substituted rather
   * than left to fail the way they do under jsdom: a global shortcut and a file
   * drop are only observable by firing them.
   */
  async function setUp(notes: readonly Note[] = [createNote({ id: 'note-42' })]): Promise<void> {
    TestBed.resetTestingModule();
    repository = new FakeNotesRepository(notes);
    attachmentsRepository = new FakeAttachmentsRepository();
    transferRepository = new FakeTransferRepository();
    fileDialog = new FakeFileDialog();
    clipboard = new FakeClipboard();
    appWindow = new FakeAppWindow();

    const handlers = new Map<string, () => void>();
    const subscribe: EventSubscriber = async (topic, handler) => {
      handlers.set(topic, handler);
      return () => handlers.delete(topic);
    };
    fireEvent = (topic) => handlers.get(topic)?.();

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
    spaces = TestBed.inject(SpacesStore);
    menu = TestBed.inject(AppMenuRegistry);
    fixture.autoDetectChanges();
    await vi.waitFor(() => expect(spaces.spaces()).toHaveLength(SPACES.length));
    // The three subscriptions land a microtask after the constructor asked for them.
    await vi.waitFor(() => expect(handlers.size).toBe(3));
  }

  beforeEach(async () => {
    await setUp();
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

  it('renames a space without touching the canvas', async () => {
    // A note carries the space id, never its name: there is nothing to reload.
    const queries = repository.queryCount;

    child(SpaceSwitcherComponent).spaceRenamed.emit({ id: 'work', name: 'Client work' });
    await vi.waitFor(() => expect(spaces.spaces()[1].name).toBe('Client work'));

    expect(repository.queryCount).toBe(queries);
  });

  it('reloads the canvas once a deleted space has handed its notes over', async () => {
    // The absorbed notes changed `spaceId` in the database, and nothing would
    // report it when the current query does not depend on the space that went.
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

      sections()[0].noteOpened.emit({ noteId: 'note-1', toggleChecked: false, extendRange: false });
      sections()[0].createRequested.emit();

      expect(openNote).toHaveBeenCalledWith('note-1');
      expect(createNoteSpy).toHaveBeenCalled();
    });

    it('checks a note instead of opening it when the card reports a modified click', () => {
      // Ctrl+click is the file-list convention the canvas took on with multiple
      // selection: it must not open the editor as well.
      const openNote = vi.spyOn(store, 'openNote');

      sections()[0].noteOpened.emit({ noteId: 'note-42', toggleChecked: true, extendRange: false });

      expect(store.checkedIds().has('note-42')).toBe(true);
      expect(store.focusedNoteId()).toBe('note-42');
      expect(openNote).not.toHaveBeenCalled();
    });

    it('extends the checked range when the card reports a shift click', () => {
      const checkRangeTo = vi.spyOn(store, 'checkRangeTo');
      const toggleChecked = vi.spyOn(store, 'toggleChecked');

      sections()[0].noteOpened.emit({ noteId: 'note-42', toggleChecked: true, extendRange: true });

      // A range wins over the toggle: both modifiers can be held at once.
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
      expect(store.checkedIds().has('note-42')).toBe(true);
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
      const setSource = vi.spyOn(store, 'setSource').mockResolvedValue();
      const setLifecycle = vi.spyOn(store, 'setLifecycle').mockResolvedValue();
      const addTag = vi.spyOn(store, 'addTag').mockResolvedValue();
      const removeTag = vi.spyOn(store, 'removeTag').mockResolvedValue();
      const deleteNote = vi.spyOn(store, 'deleteNote').mockResolvedValue();
      const overlay = child(NoteEditorOverlayComponent);
      const deadline = { kind: 'expires', at: new Date('2026-03-01T22:59:59.999Z') } as const;

      overlay.contentChanged.emit('new body');
      overlay.languageChanged.emit('json');
      overlay.sourceChanged.emit('Handbook / TLS');
      overlay.lifecycleChanged.emit(deadline);
      overlay.tagAdded.emit('urgent');
      overlay.tagRemoved.emit('later');
      overlay.deleteRequested.emit();

      expect(updateContent).toHaveBeenCalledWith('note-42', 'new body');
      expect(setLanguage).toHaveBeenCalledWith('note-42', 'json');
      expect(setSource).toHaveBeenCalledWith('note-42', 'Handbook / TLS');
      expect(setLifecycle).toHaveBeenCalledWith('note-42', deadline);
      expect(addTag).toHaveBeenCalledWith('note-42', 'urgent');
      expect(removeTag).toHaveBeenCalledWith('note-42', 'later');
      expect(deleteNote).toHaveBeenCalledWith('note-42');
    });
  });

  describe('native shortcuts', () => {
    it('captures the clipboard into a saved note when the capture event fires', async () => {
      // The global shortcut is registered in Rust, which only shows the window
      // and says so: the note is still created through the ordinary command.
      clipboard.content = 'psql -h localhost';

      fireEvent('devbox:capture');

      await vi.waitFor(() => expect(store.selectedNote()?.content).toBe('psql -h localhost'));
    });

    it('opens an unsaved draft when the new-note event fires', async () => {
      fireEvent('devbox:new-note');
      await fixture.whenStable();

      expect(store.selectedNote()?.content).toBe('');
      // Nothing is written until the note is worth keeping.
      expect(store.persistedNoteId()).toBeNull();
    });

    it('opens the quick palette when the palette event fires', async () => {
      fireEvent('devbox:palette');

      await vi.waitFor(() => expect(maybeChild(QuickPaletteComponent)).not.toBeNull());
    });
  });

  describe('file menu', () => {
    function run(id: string): void {
      menu
        .entries()
        .find((entry) => entry.id === id)!
        .run();
    }

    it('contributes its entries to the title bar, which knows no feature', () => {
      expect(menu.entries().map((entry) => entry.id)).toEqual([
        'notes.import',
        'notes.exportAll',
        'notes.exportSpace',
        'notes.exportSelection',
        'notes.copyMarkdown',
      ]);
    });

    it('takes its entries back when the page goes away', () => {
      // A tool that is not loaded has no business in the menu.
      fixture.destroy();

      expect(menu.entries()).toEqual([]);
    });

    it('keeps "export this space" unavailable until a space is active', async () => {
      const entry = menu.entries().find((candidate) => candidate.id === 'notes.exportSpace')!;
      expect(entry.disabled!()).toBe(true);

      spaces.selectSpace('work');
      await fixture.whenStable();

      expect(entry.disabled!()).toBe(false);
    });

    it('keeps the selection entries unavailable until notes are checked', async () => {
      // `disabled` is a signal precisely so it follows what is checked right now.
      const ids = ['notes.exportSelection', 'notes.copyMarkdown'];
      const entries = menu.entries().filter((entry) => ids.includes(entry.id));
      expect(entries.map((entry) => entry.disabled!())).toEqual([true, true]);

      store.toggleChecked('note-42');
      await fixture.whenStable();

      expect(entries.map((entry) => entry.disabled!())).toEqual([false, false]);
    });

    it('reloads spaces and canvas once an import brought notes in', async () => {
      fileDialog.openPath = 'C:\\bundles\\devbox-2026-01-01.json';
      const queries = repository.queryCount;

      run('notes.import');

      await vi.waitFor(() => expect(transferRepository.importedFrom).toBe(fileDialog.openPath));
      await vi.waitFor(() => expect(repository.queryCount).toBeGreaterThan(queries));
    });

    it('leaves the canvas alone when the import added nothing', async () => {
      // Exporting then re-importing at once imports zero notes, and that is
      // correct: every id is already there.
      fileDialog.openPath = 'C:\\bundles\\same-again.json';
      transferRepository.importReport = { spacesCreated: 0, notesImported: 0, notesSkipped: 4 };
      const queries = repository.queryCount;

      run('notes.import');

      await vi.waitFor(() => expect(transferRepository.importedFrom).not.toBeNull());
      await fixture.whenStable();
      expect(repository.queryCount).toBe(queries);
    });

    it('exports the whole corpus, then only the active space', async () => {
      fileDialog.savePath = 'C:\\out\\all.json';

      run('notes.exportAll');
      await vi.waitFor(() =>
        expect(transferRepository.exportedTo).toEqual({ path: 'C:\\out\\all.json', spaceId: null }),
      );

      spaces.selectSpace('work');
      await fixture.whenStable();
      run('notes.exportSpace');

      await vi.waitFor(() => expect(transferRepository.exportedTo?.spaceId).toBe('work'));
    });

    it('exports exactly the checked notes', async () => {
      fileDialog.savePath = 'C:\\out\\selection.json';
      store.toggleChecked('note-42');
      await fixture.whenStable();

      run('notes.exportSelection');

      await vi.waitFor(() => expect(transferRepository.exportedIds).toEqual(['note-42']));
    });

    it('copies the checked notes as markdown rather than sending them anywhere', async () => {
      store.toggleChecked('note-42');
      await fixture.whenStable();

      run('notes.copyMarkdown');

      await vi.waitFor(() => expect(clipboard.content).toBe(transferRepository.markdown));
      expect(transferRepository.sharedIds).toEqual(['note-42']);
      expect(TestBed.inject(StatusNotifier).status()?.key).toBe('file.copied');
    });

    it('copies the checked notes from the selection bar too', async () => {
      store.toggleChecked('note-42');
      await fixture.whenStable();

      child(SelectionBarComponent).copyRequested.emit();

      await vi.waitFor(() => expect(transferRepository.sharedIds).toEqual(['note-42']));
    });
  });

  describe('keyboard navigation', () => {
    const cards = ['n1', 'n2', 'n3', 'n4'].map((id) => createNote({ id, content: `body of ${id}` }));

    beforeEach(async () => {
      await setUp(cards);
      await vi.waitFor(() => expect(store.visibleNotes()).toHaveLength(4));
    });

    it('enters the grid on the first card when nothing is focused yet', () => {
      press('ArrowRight');

      expect(store.focusedNoteId()).toBe('n1');
    });

    it('walks the cards with the left and right arrows, stopping at both ends', () => {
      store.focusNote('n1');

      press('ArrowRight');
      expect(store.focusedNoteId()).toBe('n2');

      press('ArrowLeft');
      press('ArrowLeft');
      // Stopping beats wrapping around, which loses track of where one was.
      expect(store.focusedNoteId()).toBe('n1');
    });

    it('measures the cards to move between rows', () => {
      // The column count depends on the window width, so the page reads the
      // positions off the screen rather than assuming a grid.
      const shells = fixture.nativeElement.querySelectorAll('.card-shell') as NodeListOf<HTMLElement>;
      shells.forEach((shell, index) => {
        const rect = new DOMRect(index % 2 === 0 ? 0 : 300, index < 2 ? 0 : 200, 240, 160);
        vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(rect);
      });
      store.focusNote('n2');

      press('ArrowDown');
      expect(store.focusedNoteId()).toBe('n4');

      press('ArrowUp');
      expect(store.focusedNoteId()).toBe('n2');
    });

    it('opens the focused note on Enter', () => {
      store.focusNote('n3');

      press('Enter');

      expect(store.selectedNoteId()).toBe('n3');
    });

    it('checks and unchecks the focused note on x', () => {
      store.focusNote('n2');

      press('x');
      expect(store.checkedIds().has('n2')).toBe(true);

      press('X');
      expect(store.checkedIds().has('n2')).toBe(false);
    });

    it('copies the focused note on c', async () => {
      store.focusNote('n2');

      press('c');

      await vi.waitFor(() => expect(clipboard.content).toBe('body of n2'));
    });

    it('reports a copy the clipboard refused', async () => {
      store.focusNote('n2');
      clipboard.failNext = new Error('no clipboard');

      press('c');

      await vi.waitFor(() =>
        expect(TestBed.inject(ErrorNotifier).notice()?.ref.key).toBe('errors.copyFailed'),
      );
    });

    it('pins the focused note on p', async () => {
      store.focusNote('n1');

      press('p');

      await vi.waitFor(() => expect(store.visibleNotes().find((n) => n.id === 'n1')?.pinned).toBe(true));
    });

    it('trashes the focused note on Delete, offering to take it back', async () => {
      store.focusNote('n1');

      press('Delete');

      await vi.waitFor(() => expect(store.lastDeletion()).toEqual({ ids: ['n1'], count: 1 }));
      expect(store.visibleNotes().map((note) => note.id)).not.toContain('n1');
    });

    it('takes back the last deletion on Ctrl+Z', async () => {
      // The gesture one makes without looking at the screen, which is why it
      // reads `lastDeletion` and not the banner.
      store.focusNote('n1');
      press('Backspace');
      await vi.waitFor(() => expect(store.lastDeletion()).not.toBeNull());

      press('z', { ctrlKey: true });

      await vi.waitFor(() => expect(store.visibleNotes().map((note) => note.id)).toContain('n1'));
      expect(store.lastDeletion()).toBeNull();
    });

    it('leaves Ctrl+Z alone when nothing was deleted', () => {
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('clears the checked notes on Escape', () => {
      store.toggleChecked('n1');
      store.toggleChecked('n2');

      press('Escape');

      expect(store.checkedIds().size).toBe(0);
    });

    it('ignores the canvas keys while typing in a field', () => {
      // The letters are bare on purpose; they must not swallow a keystroke aimed
      // at the search box.
      store.focusNote('n1');
      const input = document.createElement('input');
      document.body.appendChild(input);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));

      expect(store.checkedIds().size).toBe(0);
      input.remove();
    });

    it('ignores the canvas keys while a modal holds the keyboard', async () => {
      store.openNote('n1');
      await fixture.whenStable();
      store.focusNote('n2');

      press('x');

      expect(store.checkedIds().size).toBe(0);
    });

    it('ignores a chord it does not own', () => {
      store.focusNote('n1');

      press('x', { altKey: true });

      expect(store.checkedIds().size).toBe(0);
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

      child(NoteEditorOverlayComponent).attachmentAddRequested.emit();

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

      child(NoteEditorOverlayComponent).attachmentAddRequested.emit();

      // A note one attaches a file to is no longer empty.
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
      // The WebView never sees the file: only the native side announces the paths.
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
      child(NoteEditorOverlayComponent).imagePasted.emit();

      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).attachments()).toHaveLength(1));
    });

    it('says so when the pasted clipboard carried no image after all', async () => {
      // Only the type is read in the editor; the bytes are re-read natively, and
      // by then the clipboard may hold nothing usable.
      attachmentsRepository.failNext = new Error('no image in clipboard');

      child(NoteEditorOverlayComponent).imagePasted.emit();

      await vi.waitFor(() =>
        expect(TestBed.inject(ErrorNotifier).notice()?.ref.key).toBe('attachments.pasteEmpty'),
      );
    });

    it('announces where an attachment was saved', async () => {
      fileDialog.openPath = 'C:\\shots\\capture.png';
      child(NoteEditorOverlayComponent).attachmentAddRequested.emit();
      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).attachments()).toHaveLength(1));
      const id = TestBed.inject(AttachmentsStore).attachments()[0].id;
      fileDialog.savePath = 'D:\\keep\\capture.png';

      child(NoteEditorOverlayComponent).attachmentSaveRequested.emit(id);

      await vi.waitFor(() =>
        expect(TestBed.inject(StatusNotifier).status()).toEqual({
          key: 'attachments.saved',
          params: { path: 'D:\\keep\\capture.png' },
        }),
      );
    });

    it('says nothing when the save dialog was dismissed', async () => {
      fileDialog.openPath = 'C:\\shots\\capture.png';
      child(NoteEditorOverlayComponent).attachmentAddRequested.emit();
      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).attachments()).toHaveLength(1));
      TestBed.inject(StatusNotifier).dismiss();

      child(NoteEditorOverlayComponent).attachmentSaveRequested.emit(
        TestBed.inject(AttachmentsStore).attachments()[0].id,
      );
      await fixture.whenStable();

      expect(TestBed.inject(StatusNotifier).status()).toBeNull();
    });

    it('closes the zoomed view along with the preview it shows', async () => {
      fileDialog.openPath = 'C:\\shots\\capture.png';
      child(NoteEditorOverlayComponent).attachmentAddRequested.emit();
      // An attached image opens its own preview: it is what one wants to see.
      await vi.waitFor(() => expect(TestBed.inject(AttachmentsStore).previewData()).not.toBeNull());
      const id = TestBed.inject(AttachmentsStore).previewId()!;

      child(NoteEditorOverlayComponent).imageZoomRequested.emit();
      await vi.waitFor(() => expect(maybeChild(ImageLightboxComponent)).not.toBeNull());

      // The enlarged view shows the bytes the preview loaded: without it there
      // is nothing left to show.
      child(NoteEditorOverlayComponent).attachmentPreviewToggled.emit(id);
      await vi.waitFor(() => expect(maybeChild(ImageLightboxComponent)).toBeNull());
    });
  });

  describe('{{fields}}', () => {
    const snippet = createNote({
      id: 'snippet',
      content: 'psql -h {{host}} -p {{port}}',
      placeholders: [
        { name: 'host', defaultValue: '' },
        { name: 'port', defaultValue: '5432' },
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
      // The palette captures as much as it retrieves: the shortest path between
      // an idea and a stored note.
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
      // The window hides itself: the user goes back to paste where they were.
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
          placeholders: [{ name: 'user', defaultValue: '' }],
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
      await vi.waitFor(() => expect(store.visibleNotes()).toHaveLength(2));
    });

    it('brings a restored note back to the canvas', async () => {
      await store.deleteNote('n1');
      await TestBed.inject(TrashStore).open();
      await vi.waitFor(() => expect(maybeChild(TrashPanelComponent)).not.toBeNull());

      child(TrashPanelComponent).restoreRequested.emit('n1');

      await vi.waitFor(() => expect(store.visibleNotes().map((note) => note.id)).toContain('n1'));
    });

    it('reloads the canvas when the trash panel closes', async () => {
      // Purging behind the panel changes nothing on the canvas, but restoring
      // does — and closing is the one moment that covers both.
      await TestBed.inject(TrashStore).open();
      await fixture.whenStable();
      const queries = repository.queryCount;

      child(TrashPanelComponent).closed.emit();

      await vi.waitFor(() => expect(repository.queryCount).toBeGreaterThan(queries));
      expect(TestBed.inject(TrashStore).isOpen()).toBe(false);
    });

    it('renames a tag across the corpus and reloads', async () => {
      await TestBed.inject(TagsStore).open();
      await vi.waitFor(() => expect(maybeChild(TagManagerComponent)).not.toBeNull());
      child(TagManagerComponent).toggled.emit('auth');
      await fixture.whenStable();

      child(TagManagerComponent).renameRequested.emit('authentication');

      await vi.waitFor(() => expect(repository.retagged).toEqual({ tags: ['auth'], into: 'authentication' }));
      await vi.waitFor(() => expect(store.allTags()).toEqual(['authentication']));
    });

    it('drops the selected tags from the corpus and reloads', async () => {
      await TestBed.inject(TagsStore).open();
      await vi.waitFor(() => expect(maybeChild(TagManagerComponent)).not.toBeNull());
      child(TagManagerComponent).toggled.emit('auth');
      await fixture.whenStable();

      child(TagManagerComponent).deleteRequested.emit();

      await vi.waitFor(() => expect(repository.deletedTags).toEqual(['auth']));
      await vi.waitFor(() => expect(store.allTags()).toEqual([]));
    });

    it('leaves the canvas alone when the tag action changed nothing', async () => {
      await TestBed.inject(TagsStore).open();
      await vi.waitFor(() => expect(maybeChild(TagManagerComponent)).not.toBeNull());
      const queries = repository.queryCount;

      // Nothing selected: there is no tag to rename.
      child(TagManagerComponent).renameRequested.emit('authentication');
      await fixture.whenStable();

      expect(repository.queryCount).toBe(queries);
    });
  });
});
