import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppEventsService } from '@core/ipc/app-events.service';
import { contribute } from '@core/contributions/contribution.registry';
import { AppMenuEntry, AppMenuRegistry } from '@core/menu/app-menu.registry';
import { SettingsPage, SettingsRegistry } from '@core/settings/settings-registry';
import { ShortcutGroup, ShortcutsRegistry } from '@core/shortcuts/shortcuts.registry';
import { ClipboardService } from '@core/clipboard/clipboard.service';
import { ClockService } from '@core/time/clock.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FileDropService } from '@core/window/file-drop.service';
import { StatusNotifier } from '@core/notifications/status.service';
import { Note } from './model/note.model';
import { AttachmentsStore } from './state/attachments.store';
import { LibraryStore } from './state/library.store';
import { NotesRevision } from './state/notes-revision';
import { NotesStore } from './state/notes.store';
import { SampleNotesService } from './state/sample-notes.service';
import { PaletteStore } from './state/palette.store';
import { SpacesStore } from './state/spaces.store';
import { TagsStore } from './state/tags.store';
import { TrashStore } from './state/trash.store';
import { FilterChipsComponent } from './ui/filter-chips/filter-chips.component';
import { CardBox, FocusDirection, nextFocusIndex } from './ui/grid-navigation.util';
import { LanguageRailComponent } from './ui/language-rail/language-rail.component';
import { NewNoteButtonComponent } from './ui/new-note-button/new-note-button.component';
import { NoteActivation } from './ui/note-card/note-card.component';
import {
  FillRequest,
  NoteEditorOverlayComponent,
} from './ui/note-editor-overlay/note-editor-overlay.component';
import { NoteSectionComponent } from './ui/note-section/note-section.component';
import { PlaceholderFormComponent } from './ui/placeholder-form/placeholder-form.component';
import { ImageLightboxComponent } from './ui/image-lightbox/image-lightbox.component';
import { QuickPaletteComponent } from './ui/quick-palette/quick-palette.component';
import { SearchBoxComponent } from './ui/search-box/search-box.component';
import { SelectionBarComponent } from './ui/selection-bar/selection-bar.component';
import {
  SpaceDeletion,
  SpaceRenaming,
  SpaceSwitcherComponent,
} from './ui/space-switcher/space-switcher.component';
import { TagManagerComponent } from './ui/tag-manager/tag-manager.component';
import { TagRailComponent } from './ui/tag-rail/tag-rail.component';
import { TrashPanelComponent } from './ui/trash-panel/trash-panel.component';
import { VariablesPageComponent } from './ui/variables-page/variables-page.component';
import { UndoBarComponent } from './ui/undo-bar/undo-bar.component';

/** Canvas arrows, used when focus is not in a field. */
const DIRECTIONS: Record<string, FocusDirection> = {
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** A keystroke meant for an input does not belong to the canvas. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * "Variables" edits `{{field}}` values — notes vocabulary, which is why it is
 * contributed from here rather than known by `layout/`.
 */
const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    id: 'notes.variables',
    labelKey: 'settings.pages.variables',
    order: 20,
    component: VariablesPageComponent,
  },
];

/**
 * The canvas, editor and palette keys belong to the notes, so the sheet lists
 * them without knowing them. The **global** shortcuts are not here — they are
 * the application's, and the sheet reads them from the preferences.
 *
 * Key names are left untranslated: they are already the vocabulary of the
 * accelerators shown in the preferences. What is not a key press — a click — is
 * said in the label rather than drawn as a cap.
 */
const CANVAS_SHORTCUTS: readonly ShortcutGroup[] = [
  {
    id: 'notes.canvas',
    labelKey: 'shortcuts.groups.canvas',
    order: 10,
    shortcuts: [
      { keys: ['Ctrl', 'K'], labelKey: 'shortcuts.canvas.search' },
      { keys: ['↑ ↓ ← →'], labelKey: 'shortcuts.canvas.move' },
      { keys: ['Enter'], labelKey: 'shortcuts.canvas.open' },
      { keys: ['C'], labelKey: 'shortcuts.canvas.copy' },
      { keys: ['P'], labelKey: 'shortcuts.canvas.pin' },
      { keys: ['X'], labelKey: 'shortcuts.canvas.check' },
      { keys: ['Ctrl'], labelKey: 'shortcuts.canvas.checkWithClick' },
      { keys: ['Shift'], labelKey: 'shortcuts.canvas.extendWithClick' },
      { keys: ['Delete'], labelKey: 'shortcuts.canvas.trash' },
      { keys: ['Ctrl', 'Z'], labelKey: 'shortcuts.canvas.undo' },
      { keys: ['Escape'], labelKey: 'shortcuts.canvas.clearSelection' },
    ],
  },
  {
    id: 'notes.editor',
    labelKey: 'shortcuts.groups.editor',
    order: 20,
    shortcuts: [
      { keys: ['Escape'], labelKey: 'shortcuts.editor.close' },
      { keys: ['Enter'], labelKey: 'shortcuts.editor.newItem' },
      { keys: ['Backspace'], labelKey: 'shortcuts.editor.removeItem' },
      { keys: ['Alt', '↑ ↓'], labelKey: 'shortcuts.editor.moveItem' },
    ],
  },
  {
    id: 'notes.palette',
    labelKey: 'shortcuts.groups.palette',
    order: 30,
    shortcuts: [
      { keys: ['↑ ↓'], labelKey: 'shortcuts.palette.navigate' },
      { keys: ['Enter'], labelKey: 'shortcuts.palette.paste' },
      { keys: ['Tab'], labelKey: 'shortcuts.palette.open' },
      { keys: ['Escape'], labelKey: 'shortcuts.palette.close' },
    ],
  },
];

/**
 * The feature's only page: it wires the stores onto the display components,
 * whose children stay purely derived from their inputs.
 *
 * It is also what **contributes the "File" menu entries**, the preferences page
 * and the shortcut groups: the titlebar knows no feature. Reloading the canvas
 * after another store has written is *not* its job any more — that goes through
 * [`NotesRevision`].
 */
@Component({
  selector: 'app-notes-page',
  imports: [
    SpaceSwitcherComponent,
    SearchBoxComponent,
    FilterChipsComponent,
    NewNoteButtonComponent,
    SelectionBarComponent,
    TagRailComponent,
    LanguageRailComponent,
    NoteSectionComponent,
    NoteEditorOverlayComponent,
    QuickPaletteComponent,
    ImageLightboxComponent,
    PlaceholderFormComponent,
    TrashPanelComponent,
    TagManagerComponent,
    UndoBarComponent,
    TranslocoPipe,
  ],
  templateUrl: './notes-page.component.html',
  styleUrl: './notes-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class NotesPageComponent {
  protected readonly store = inject(NotesStore);
  protected readonly spaces = inject(SpacesStore);
  protected readonly palette = inject(PaletteStore);
  protected readonly trash = inject(TrashStore);
  protected readonly tags = inject(TagsStore);
  protected readonly library = inject(LibraryStore);
  protected readonly attachments = inject(AttachmentsStore);

  private readonly clipboard = inject(ClipboardService);
  private readonly clock = inject(ClockService);
  private readonly notifier = inject(ErrorNotifier);
  private readonly status = inject(StatusNotifier);
  private readonly menu = inject(AppMenuRegistry);
  private readonly settingsPages = inject(SettingsRegistry);
  private readonly shortcutGroups = inject(ShortcutsRegistry);
  private readonly samples = inject(SampleNotesService);
  private readonly revision = inject(NotesRevision);

  /** The preview shown full size above the editor. */
  protected readonly imageZoomed = signal(false);

  /** Note dont on remplit les `{{champs}}` avant copie, hors palette. */
  protected readonly fillTarget = signal<Note | null>(null);

  /** The filled body the editor preview shows; `null` before the first request. */
  protected readonly filledPreview = signal<string | null>(null);

  /**
   * The last preview request sent. Filling crosses the bridge, and two answers
   * can come back out of order: only the current request may render.
   */
  private latestPreviewRequest: FillRequest | null = null;

  private readonly sectionElements = viewChildren(NoteSectionComponent, { read: ElementRef });

  /**
   * An open modal takes the keyboard: neither the search shortcut nor canvas
   * navigation may act behind it.
   */
  protected readonly canvasHasFocus = computed(
    () =>
      this.store.selectedNote() === null &&
      !this.palette.isOpen() &&
      !this.trash.isOpen() &&
      !this.tags.isOpen() &&
      this.fillTarget() === null,
  );

  protected readonly searchShortcutEnabled = this.canvasHasFocus;

  /**
   * The global shortcuts are registered on the Rust side, which only shows the
   * window and says so: creation stays here, and so goes through the same
   * `create_note` as any other note.
   */
  constructor() {
    const events = inject(AppEventsService);
    const drops = inject(FileDropService);
    const destroyRef = inject(DestroyRef);

    destroyRef.onDestroy(events.on('devbox:capture', () => void this.store.captureFromClipboard()));
    destroyRef.onDestroy(events.on('devbox:new-note', () => this.store.createNote()));
    destroyRef.onDestroy(events.on('devbox:palette', () => void this.palette.open()));

    // Drag and drop is a window event: this is where its target is decided, and
    // it targets something only when the editor is open.
    destroyRef.onDestroy(drops.on((paths) => void this.onFilesDropped(paths)));

    contribute(this.menu, this.menuEntries());
    contribute(this.settingsPages, SETTINGS_PAGES);
    contribute(this.shortcutGroups, CANVAS_SHORTCUTS);

    // A fresh installation has no space, so not even a creatable note: the
    // samples are what replaces an empty, silent canvas.
    void this.seedSamples();

    // Attachments follow the **persisted** note: a draft has no row yet, and
    // nothing can be attached to it.
    effect(() => void this.attachments.openFor(this.store.persistedNoteId()));

    // A preview belongs to the note that asked for it: keeping it while opening
    // the next would show the previous note's filled body for a round trip.
    effect(() => {
      this.store.selectedNoteId();
      this.latestPreviewRequest = null;
      this.filledPreview.set(null);
    });
  }

  // --- Menu « Fichier » ------------------------------------------------------

  /**
   * The titlebar shows what the features register. `disabled` is a signal:
   * "Export selection" follows what is ticked right now.
   */
  private menuEntries(): readonly AppMenuEntry[] {
    const nothingChecked = computed(() => !this.store.hasSelection());

    return [
      { id: 'notes.import', labelKey: 'file.import', order: 10, run: () => void this.onImport() },
      {
        id: 'notes.exportAll',
        labelKey: 'file.exportAll',
        order: 20,
        run: () => void this.library.export(null, this.clock.now()),
      },
      {
        id: 'notes.exportSpace',
        labelKey: 'file.exportSpace',
        order: 30,
        disabled: computed(() => this.spaces.activeSpaceId() === null),
        run: () => void this.library.export(this.spaces.activeSpaceId(), this.clock.now()),
      },
      {
        id: 'notes.exportSelection',
        labelKey: 'file.exportSelection',
        order: 40,
        disabled: nothingChecked,
        run: () => void this.library.exportSelection(this.checkedIds(), this.clock.now()),
      },
      {
        id: 'notes.copyMarkdown',
        labelKey: 'file.copyMarkdown',
        order: 50,
        disabled: nothingChecked,
        run: () => void this.library.copyAsMarkdown(this.checkedIds()),
      },
    ];
  }

  /**
   * First launch: the sample notes are filed before the user sees an empty
   * canvas. The spaces reload afterwards — they already read an empty database.
   */
  private async seedSamples(): Promise<void> {
    if (!(await this.samples.seedIfFirstRun())) return;

    this.spaces.reload();
    this.revision.bump();
  }

  private checkedIds(): readonly string[] {
    return this.store.checkedNotes().map((note) => note.id);
  }

  private async onImport(): Promise<void> {
    // Only the spaces are reloaded here: the canvas follows `NotesRevision`,
    // which the library bumps itself.
    if (await this.library.import()) {
      this.spaces.reload();
    }
  }

  // --- Spaces ----------------------------------------------------------------

  protected onSpaceRenamed({ id, name }: SpaceRenaming): void {
    // Nothing to reload: a note carries only the `spaceId`, never the name.
    void this.spaces.renameSpace(id, name);
  }

  /** The store bumps `NotesRevision` itself; nothing to chain here. */
  protected onSpaceDeleted({ id, targetSpaceId }: SpaceDeletion): void {
    void this.spaces.deleteSpace(id, targetSpaceId);
  }

  // --- Opening and selection -------------------------------------------------

  protected onNoteActivated({ noteId, toggleChecked, extendRange }: NoteActivation): void {
    if (extendRange) {
      this.store.checkRangeTo(noteId);
      return;
    }
    if (toggleChecked) {
      this.store.toggleChecked(noteId);
      this.store.focusNote(noteId);
      return;
    }
    this.store.openNote(noteId);
  }

  protected onCopySelection(): void {
    void this.library.copyAsMarkdown(this.checkedIds());
  }

  // --- Trash and tags --------------------------------------------------------

  protected onRestore(id: string): void {
    void this.trash.restore(id);
  }

  protected onRenameTag(into: string): void {
    void this.tags.renameSelected(into);
  }

  protected onDeleteTags(): void {
    void this.tags.deleteSelected();
  }

  // --- Attachments -----------------------------------------------------------

  /**
   * Attaching demands a note **in the database**, so the draft is saved on the
   * way — a note you attach a file to is no longer empty.
   *
   * ⚠️ The attachment store is re-pointed **here** rather than waiting for the
   * effect on `persistedNoteId`, which only runs on the next detection cycle —
   * after the write that follows, which would attach nothing and not say so.
   * `openFor` is idempotent, so this is a no-op when the note already existed.
   */
  private async noteToAttachTo(): Promise<string | null> {
    const noteId = await this.store.materialiseDraft();
    if (noteId) {
      await this.attachments.openFor(noteId);
    }

    return noteId;
  }

  protected async onAttachRequested(): Promise<void> {
    if (await this.noteToAttachTo()) {
      await this.attachments.attach();
    }
  }

  protected async onImagePasted(): Promise<void> {
    if (!(await this.noteToAttachTo())) return;

    if (!(await this.attachments.attachClipboardImage(this.clock.now()))) {
      this.notifier.notify({ ref: { key: 'attachments.pasteEmpty' } });
    }
  }

  protected async onSaveAttachment(id: string): Promise<void> {
    const path = await this.attachments.saveAs(id);
    if (path) {
      this.status.notify({ key: 'attachments.saved', params: { path } });
    }
  }

  /**
   * Closing the preview closes the lightbox too: it shows the bytes the preview
   * loaded, and keeping them on screen without it makes no sense.
   */
  protected onTogglePreview(id: string): void {
    this.imageZoomed.set(false);
    void this.attachments.togglePreview(id);
  }

  /** A drop targets something only when a note is open to receive it. */
  private async onFilesDropped(paths: readonly string[]): Promise<void> {
    if (this.store.selectedNote() === null || paths.length === 0) return;
    if (!(await this.noteToAttachTo())) return;

    for (const path of paths) {
      await this.attachments.attachPath(path);
    }
  }

  // --- `{{…}}` fields --------------------------------------------------------

  protected onFillRequested(noteId: string): void {
    this.fillTarget.set(this.store.visibleNotes().find((note) => note.id === noteId) ?? null);
  }

  /**
   * Fills then copies: filling is a back-end rule, not one of ours.
   *
   * The values are **kept** on the way. There is one set per note — the
   * editor panel, the card and the palette all share it — otherwise filling
   * twice in a row at the same place would ask the same thing twice.
   */
  protected async onFillSubmitted(values: Record<string, string>): Promise<void> {
    const note = this.fillTarget();
    if (!note) return;

    this.fillTarget.set(null);
    await this.copy(await this.store.fillPlaceholders(note.content, values));
    await this.store.setPlaceholderValues(note.id, values);
  }

  /** The editor preview: the page fills, the editor displays. */
  protected async onFillPreviewRequested(request: FillRequest): Promise<void> {
    this.latestPreviewRequest = request;
    const filled = await this.store.fillPlaceholders(request.content, request.values);

    if (this.latestPreviewRequest === request) {
      this.filledPreview.set(filled);
    }
  }

  /**
   * Copy from the editor. The acknowledgement goes through the status banner
   * rather than the button's tick: the text only exists once the bridge has
   * been crossed, and ticking early would announce a copy that did not happen.
   */
  protected async onFilledCopyRequested(request: FillRequest): Promise<void> {
    const filled = await this.store.fillPlaceholders(request.content, request.values);

    if (await this.copy(filled)) {
      this.status.notify({ key: 'placeholders.copiedFilled' });
    }
  }

  protected async onFillRaw(): Promise<void> {
    const note = this.fillTarget();
    this.fillTarget.set(null);
    if (note) {
      await this.copy(note.content);
    }
  }

  // --- Palette ---------------------------------------------------------------

  protected async onPaletteFill(values: Record<string, string>): Promise<void> {
    const note = this.palette.pendingFill();
    if (!note) return;

    await this.palette.copyAndDismiss(await this.store.fillPlaceholders(note.content, values));
    // Kept as elsewhere: the palette fills the same note as the editor.
    await this.store.setPlaceholderValues(note.id, values);
  }

  protected onPaletteOpen(noteId: string): void {
    this.palette.close();
    this.store.openNote(noteId);
  }

  /**
   * The palette captures as much as it retrieves: on its create row, what was
   * typed becomes a note's content, saved and opened.
   *
   * `PaletteStore` does not create anything itself — it does not know
   * `NotesStore`, and the other way round would be a cycle.
   */
  protected async onPaletteChosen(): Promise<void> {
    const content = this.palette.takeNewNoteContent();
    if (content !== null) {
      await this.store.createWithContent(content);
      return;
    }

    await this.palette.chooseHighlighted();
  }

  // --- Keyboard navigation ---------------------------------------------------

  /**
   * The canvas is driven by keyboard when focus is neither in a field nor
   * behind a modal. The keys are deliberately bare letters: they only serve
   * here, where no typing is in progress.
   */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.canvasHasFocus() || isTypingTarget(event.target)) return;

    // `Ctrl+Z` takes back the last deletion even after the banner is gone: it
    // is the gesture one makes without looking at the screen.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      if (this.store.lastDeletion()) {
        event.preventDefault();
        void this.store.undoDeletion();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const direction = DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      this.moveFocus(direction);
      return;
    }

    const focused = this.focusedNote();

    switch (event.key) {
      case 'Enter':
        if (focused) {
          event.preventDefault();
          this.store.openNote(focused.id);
        }
        break;
      case 'x':
      case 'X':
        if (focused) {
          event.preventDefault();
          this.store.toggleChecked(focused.id);
        }
        break;
      case 'c':
      case 'C':
        if (focused) {
          event.preventDefault();
          void this.copy(focused.content);
        }
        break;
      case 'p':
      case 'P':
        if (focused) {
          event.preventDefault();
          void this.store.togglePinned(focused.id);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (focused) {
          event.preventDefault();
          void this.store.deleteNote(focused.id);
        }
        break;
      case 'Escape':
        if (this.store.hasSelection()) {
          event.preventDefault();
          this.store.clearSelection();
        }
        break;
    }
  }

  private focusedNote(): Note | null {
    const index = this.store.focusedIndex();
    return index < 0 ? null : (this.store.visibleNotes()[index] ?? null);
  }

  /**
   * The positions are **measured**: the column count depends on the window
   * width, and each section has its own number of cards. With no current focus,
   * the first move enters through the first card.
   */
  private moveFocus(direction: FocusDirection): void {
    const boxes = this.cardBoxes();
    if (boxes.length === 0) return;

    const current = this.store.focusedIndex();
    if (current < 0) {
      this.store.focusIndex(0);
      return;
    }

    this.store.focusIndex(nextFocusIndex(boxes, current, direction));
  }

  private cardBoxes(): readonly CardBox[] {
    return this.sectionElements()
      .flatMap((section) =>
        Array.from((section.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.card-shell')),
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, left: rect.left };
      });
  }

  /** Answers what the clipboard actually accepted: an acknowledgement is earned. */
  private async copy(content: string): Promise<boolean> {
    if (await this.clipboard.copy(content)) return true;

    this.notifier.notify({ ref: { key: 'errors.copyFailed' } });
    return false;
  }
}
