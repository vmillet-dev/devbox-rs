import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { NotesStore } from '../../../core/stores/notes.store';
import { MOCK_SPACES } from '../../../core/data/spaces.mock-data';
import { NotesTopbarComponent } from '../components/notes-topbar/notes-topbar.component';
import { TagRailComponent } from '../components/tag-rail/tag-rail.component';
import { NoteCanvasComponent } from '../components/note-canvas/note-canvas.component';
import { NoteEditorOverlayComponent } from '../components/note-editor-overlay/note-editor-overlay.component';

@Component({
  selector: 'app-notes-page',
  imports: [NotesTopbarComponent, TagRailComponent, NoteCanvasComponent, NoteEditorOverlayComponent],
  templateUrl: './notes-page.component.html',
  styleUrl: './notes-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class NotesPageComponent {
  protected readonly store = inject(NotesStore);
  protected readonly spaces = MOCK_SPACES;

  protected readonly activeSpaceId = signal(MOCK_SPACES[0].id);
  protected readonly activeSpace = computed(
    () => this.spaces.find((space) => space.id === this.activeSpaceId()) ?? this.spaces[0],
  );

  private readonly topbar = viewChild.required(NotesTopbarComponent);

  protected onKeydown(event: KeyboardEvent): void {
    const isSearchShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
    if (isSearchShortcut) {
      event.preventDefault();
      this.topbar().focusSearch();
    }
  }

  protected onTitleChanged(title: string): void {
    const id = this.store.selectedNoteId();
    if (id) {
      this.store.renameNote(id, title);
    }
  }

  protected onPinToggled(): void {
    const id = this.store.selectedNoteId();
    if (id) {
      this.store.togglePinned(id);
    }
  }
}
