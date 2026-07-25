import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FALLBACK_LANGUAGE, LANGUAGE_LABELS } from '@core/models/language.model';
import { Note } from '@core/models/note.model';
import { ClockService } from '@core/time/clock.service';
import { relativeTimeRef } from '@core/utils/relative-time.util';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { CodeViewerComponent } from '@shared/ui/code-viewer/code-viewer.component';
import { LifecycleBadgeComponent } from '@shared/ui/lifecycle-badge/lifecycle-badge.component';
import { TagPillComponent } from '@shared/ui/tag-pill/tag-pill.component';

/** Instancié une seule fois : `TextEncoder` est sans état, en recréer un à chaque recalcul est gratuit mais inutile. */
const TEXT_ENCODER = new TextEncoder();

@Component({
  selector: 'app-note-editor-overlay',
  imports: [
    TagPillComponent,
    LifecycleBadgeComponent,
    CodeViewerComponent,
    FocusTrapDirective,
    TranslocoPipe,
  ],
  templateUrl: './note-editor-overlay.component.html',
  styleUrl: './note-editor-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class NoteEditorOverlayComponent {
  private readonly clock = inject(ClockService);

  readonly note = input<Note | null>(null);

  readonly closed = output<void>();
  readonly titleChanged = output<string>();
  readonly pinToggled = output<void>();

  protected readonly languageLabel = computed(
    () => LANGUAGE_LABELS[this.note()?.language ?? FALLBACK_LANGUAGE],
  );
  protected readonly lineCount = computed(() => this.note()?.content.split('\n').length ?? 0);
  protected readonly byteSize = computed(() => TEXT_ENCODER.encode(this.note()?.content ?? '').length);
  protected readonly modifiedRef = computed(() => {
    const note = this.note();
    return note ? relativeTimeRef(note.updatedAt, this.clock.now()) : null;
  });

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
