import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NotesStore } from '@core/stores/notes.store';
import { SpacesStore } from '@core/stores/spaces.store';
import { NoteCanvasComponent } from '../components/note-canvas/note-canvas.component';
import { NoteEditorOverlayComponent } from '../components/note-editor-overlay/note-editor-overlay.component';
import { NotesTopbarComponent } from '../components/notes-topbar/notes-topbar.component';
import { TagRailComponent } from '../components/tag-rail/tag-rail.component';

@Component({
  selector: 'app-notes-page',
  imports: [NotesTopbarComponent, TagRailComponent, NoteCanvasComponent, NoteEditorOverlayComponent],
  templateUrl: './notes-page.component.html',
  styleUrl: './notes-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesPageComponent {
  protected readonly store = inject(NotesStore);
  protected readonly spaces = inject(SpacesStore);

  /** Le raccourci de recherche est neutralisé tant que la modale est ouverte. */
  protected readonly searchShortcutEnabled = computed(() => this.store.selectedNote() === null);

  protected onTitleChanged(title: string): void {
    const id = this.store.selectedNoteId();
    if (id) {
      void this.store.renameNote(id, title);
    }
  }

  protected onPinToggled(): void {
    const id = this.store.selectedNoteId();
    if (id) {
      void this.store.togglePinned(id);
    }
  }
}
