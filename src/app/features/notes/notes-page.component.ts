import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppEventsService, GlobalAction } from '@core/ipc/app-events.service';
import { contribute } from '@core/contributions/contribution.registry';
import { AppMenuEntry, AppMenuRegistry } from '@core/menu/app-menu.registry';
import { SettingsPage, SettingsRegistry } from '@core/settings/settings-registry';
import { ShortcutGroup, ShortcutsRegistry } from '@core/shortcuts/shortcuts.registry';
import { ClockService } from '@core/time/clock.service';
import { DialogStack } from '@shared/ui/dialog/dialog-stack';
import { AttachmentsStore } from './state/attachments.store';
import { LibraryStore } from './state/library.store';
import { NoteSelectionStore } from './state/note-selection.store';
import { NotesQueryStore } from './state/notes-query.store';
import { NotesRevision } from './state/notes-revision';
import { NotesStore } from './state/notes.store';
import { PlaceholderFillStore } from './state/placeholder-fill.store';
import { SampleNotesService } from './state/sample-notes.service';
import { PaletteStore } from './state/palette.store';
import { SpacesStore } from './state/spaces.store';
import { TagsStore } from './state/tags.store';
import { TrashStore } from './state/trash.store';
import { CANVAS_SHORTCUT_GROUP, CanvasKeyboardDirective } from './ui/canvas-keyboard.directive';
import { FilterChipsComponent } from './ui/filter-chips/filter-chips.component';
import { LanguageRailComponent } from './ui/language-rail/language-rail.component';
import { NewNoteButtonComponent } from './ui/new-note-button/new-note-button.component';
import { NoteActivation } from './ui/note-card/note-card.component';
import { NoteEditorOverlayComponent } from './ui/note-editor-overlay/note-editor-overlay.component';
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

/**
 * Notes vocabulary, which is why it is contributed from here rather than known by
 * `layout/`.
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
 * The canvas group comes from [`CanvasKeyboardDirective`], where the same table also
 * binds the keys; the two below are documentation, their keys being handled by the
 * editor and by the palette themselves. Key names stay untranslated.
 */
const NOTES_SHORTCUTS: readonly ShortcutGroup[] = [
  CANVAS_SHORTCUT_GROUP,
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
 * It is what **contributes the "File" menu entries**, the preferences page and the
 * shortcut groups: the titlebar knows no feature, and `contribute()` withdraws them
 * when this page is destroyed — hence here and not in a root store that would outlive
 * it.
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
  hostDirectives: [CanvasKeyboardDirective],
  templateUrl: './notes-page.component.html',
  styleUrl: './notes-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesPageComponent {
  protected readonly canvas = inject(NotesQueryStore);
  protected readonly selection = inject(NoteSelectionStore);
  protected readonly store = inject(NotesStore);
  protected readonly spaces = inject(SpacesStore);
  protected readonly palette = inject(PaletteStore);
  protected readonly trash = inject(TrashStore);
  protected readonly tags = inject(TagsStore);
  protected readonly library = inject(LibraryStore);
  protected readonly attachments = inject(AttachmentsStore);
  protected readonly fill = inject(PlaceholderFillStore);

  private readonly clock = inject(ClockService);
  private readonly menu = inject(AppMenuRegistry);
  private readonly settingsPages = inject(SettingsRegistry);
  private readonly shortcutGroups = inject(ShortcutsRegistry);
  private readonly samples = inject(SampleNotesService);
  private readonly revision = inject(NotesRevision);
  private readonly dialogs = inject(DialogStack);

  /**
   * An open modal takes the keyboard. Asked of [`DialogStack`] rather than of each
   * store in turn: the page used to name its five modals here and would have missed
   * the sixth.
   */
  protected readonly searchShortcutEnabled = computed(() => !this.dialogs.hasOpenDialog());

  constructor() {
    const events = inject(AppEventsService);
    const destroyRef = inject(DestroyRef);

    destroyRef.onDestroy(events.on((action) => this.runGlobalAction(action)));

    contribute(this.menu, this.menuEntries());
    contribute(this.settingsPages, SETTINGS_PAGES);
    contribute(this.shortcutGroups, NOTES_SHORTCUTS);

    // A fresh installation has no space, so not even a creatable note.
    void this.seedSamples();
  }

  /**
   * The native side shows the window and says what was wanted; creating the note stays
   * here, so it goes through the same `create_note` as any other.
   *
   * No `default`: the switch is exhaustive over a **generated** union, so a variant
   * added in Rust stops this compiling until it is handled here.
   */
  private runGlobalAction(action: GlobalAction): void {
    switch (action) {
      case 'capture':
        void this.store.captureFromClipboard();
        break;
      case 'new-note':
        this.store.createNote();
        break;
      case 'palette':
        void this.palette.open();
        break;
    }
  }

  /** `disabled` is a signal: "Export selection" follows what is ticked right now. */
  private menuEntries(): readonly AppMenuEntry[] {
    const nothingChecked = computed(() => !this.selection.hasSelection());
    const checked = (): readonly string[] => this.selection.checkedNoteIds();

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
        run: () => void this.library.exportSelection(checked(), this.clock.now()),
      },
      {
        id: 'notes.copyMarkdown',
        labelKey: 'file.copyMarkdown',
        order: 50,
        disabled: nothingChecked,
        run: () => void this.library.copyAsMarkdown(checked()),
      },
    ];
  }

  /** The spaces reload afterwards — they had already read an empty database. */
  private async seedSamples(): Promise<void> {
    if (!(await this.samples.seedIfFirstRun())) return;

    this.spaces.reload();
    this.revision.bump();
  }

  private async onImport(): Promise<void> {
    // Only the spaces: the canvas follows `NotesRevision`, which the library bumps.
    if (await this.library.import()) {
      this.spaces.reload();
    }
  }

  protected onSpaceRenamed({ id, name }: SpaceRenaming): void {
    // Nothing to reload: a note carries only the `spaceId`, never the name.
    void this.spaces.renameSpace(id, name);
  }

  protected onSpaceDeleted({ id, targetSpaceId }: SpaceDeletion): void {
    void this.spaces.deleteSpace(id, targetSpaceId);
  }

  protected onNoteActivated({ noteId, toggleChecked, extendRange }: NoteActivation): void {
    if (extendRange) {
      this.selection.checkRangeTo(noteId);
      return;
    }
    if (toggleChecked) {
      this.selection.toggleChecked(noteId);
      this.selection.focusNote(noteId);
      return;
    }
    this.store.openNote(noteId);
  }

  protected onCopySelection(): void {
    void this.library.copyAsMarkdown(this.selection.checkedNoteIds());
  }

  protected onRestore(id: string): void {
    void this.trash.restore(id);
  }

  protected onRenameTag(into: string): void {
    void this.tags.renameSelected(into);
  }

  protected onDeleteTags(): void {
    void this.tags.deleteSelected();
  }

  protected onPaletteOpen(noteId: string): void {
    this.palette.close();
    this.store.openNote(noteId);
  }

  /**
   * `PaletteStore` creates nothing itself — it does not know `NotesStore`, and the
   * other way round would be a cycle.
   */
  protected async onPaletteChosen(): Promise<void> {
    const content = this.palette.takeNewNoteContent();
    if (content !== null) {
      await this.store.createWithContent(content);
      return;
    }

    await this.palette.chooseHighlighted();
  }
}
