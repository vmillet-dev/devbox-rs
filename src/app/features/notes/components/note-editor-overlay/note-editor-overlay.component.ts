import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Note } from '../../../../core/models/note.model';
import { LANGUAGE_LABELS } from '../../../../core/models/language.model';
import { TagPillComponent } from '../../../../shared/ui/tag-pill/tag-pill.component';
import { LifecycleBadgeComponent } from '../../../../shared/ui/lifecycle-badge/lifecycle-badge.component';
import { RelativeTimePipe } from '../../../../shared/pipes/relative-time.pipe';
import { CodeViewerComponent } from '../code-viewer/code-viewer.component';

@Component({
  selector: 'app-note-editor-overlay',
  imports: [TagPillComponent, LifecycleBadgeComponent, CodeViewerComponent, RelativeTimePipe],
  templateUrl: './note-editor-overlay.component.html',
  styleUrl: './note-editor-overlay.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class NoteEditorOverlayComponent {
  readonly note = input<Note | null>(null);

  readonly closed = output<void>();
  readonly titleChanged = output<string>();
  readonly pinToggled = output<void>();

  protected readonly languageLabel = computed(() => LANGUAGE_LABELS[this.note()?.language ?? 'txt']);
  protected readonly lineCount = computed(() => this.note()?.content.split('\n').length ?? 0);
  protected readonly byteSize = computed(() => new TextEncoder().encode(this.note()?.content ?? '').length);

  protected onEscape(): void {
    if (this.note()) {
      this.closed.emit();
    }
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }
}
