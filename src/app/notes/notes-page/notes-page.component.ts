import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppEventsService, GlobalAction } from '@core/ipc/app-events.service';
import { DialogStack } from '@shared/layout/dialog/dialog-stack';
import { AttachmentsStore } from '@core/state/attachments.store';
import { LibraryStore } from '@core/state/library.store';
import { NoteSelectionStore } from '@core/state/note-selection.store';
import { NotesQueryStore } from '@core/state/notes-query.store';
import { NotesRevision } from '@core/state/notes-revision';
import { NotesStore } from '@core/state/notes.store';
import { PlaceholderFillStore } from '@core/state/placeholder-fill.store';
import { SampleNotesService } from '@core/state/sample-notes.service';
import { PaletteStore } from '@core/state/palette.store';
import { SpacesStore } from '@core/state/spaces.store';
import { TagsStore } from '@core/state/tags.store';
import { TrashStore } from '@core/state/trash.store';
import { CanvasKeyboardDirective } from '@shared/directives/canvas-keyboard.directive';
import { FilterChipsComponent } from '../topbar/filter-chips/filter-chips.component';
import { LanguageRailComponent } from '../language-rail/language-rail.component';
import { NewNoteButtonComponent } from '../topbar/new-note-button/new-note-button.component';
import { NoteActivation } from '../note-section/note-card/note-card.component';
import { NoteEditorOverlayComponent } from '../overlays/note-editor-overlay/note-editor-overlay.component';
import { NoteSectionComponent } from '../note-section/note-section.component';
import { PlaceholderFormComponent } from '../overlays/placeholder-form/placeholder-form.component';
import { ImageLightboxComponent } from '../image-lightbox/image-lightbox.component';
import { QuickPaletteComponent } from '../overlays/quick-palette/quick-palette.component';
import { SearchBoxComponent } from '../topbar/search-box/search-box.component';
import { SelectionBarComponent } from '../selection-bar/selection-bar.component';
import {
  SpaceDeletion,
  SpaceRenaming,
  SpaceSwitcherComponent,
} from '../topbar/space-switcher/space-switcher.component';
import { TagManagerComponent } from '../overlays/tag-manager/tag-manager.component';
import { TagRailComponent } from '../tag-rail/tag-rail.component';
import { TrashPanelComponent } from '../overlays/trash-panel/trash-panel.component';
import { UndoBarComponent } from '../undo-bar/undo-bar.component';

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

  /** The spaces reload afterwards — they had already read an empty database. */
  private async seedSamples(): Promise<void> {
    if (!(await this.samples.seedIfFirstRun())) return;

    this.spaces.reload();
    this.revision.bump();
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
