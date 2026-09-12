import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/i18n/translation-ref.model';
import { ClockService } from '@core/time/clock.service';
import { relativeTimeRef } from '@core/time/relative-time.util';
import { DialogComponent } from '@shared/ui/dialog/dialog.component';
import { TrashedNote } from '@features/notes/model/note.model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SNIPPET_LINES = 2;

interface TrashRow {
  readonly note: TrashedNote;
  /**
   * Empty for a todo list: its items do not travel this far, a discarded note being
   * neither opened nor ticked.
   */
  readonly snippet: string;
  readonly snippetKey: string | null;
  readonly deletedRef: TranslationRef;
  readonly purgeRef: TranslationRef;
}

/**
 * The purge deadline is computed at render rather than received as a label: like the
 * cards' relative times, it has to age on screen without a round trip.
 */
@Component({
  selector: 'app-trash-panel',
  imports: [DialogComponent, TranslocoPipe],
  templateUrl: './trash-panel.component.html',
  styleUrl: './trash-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrashPanelComponent {
  private readonly clock = inject(ClockService);

  readonly notes = input.required<readonly TrashedNote[]>();
  readonly isLoading = input(false);

  readonly closed = output<void>();
  readonly restoreRequested = output<string>();
  readonly purgeRequested = output<string>();
  readonly emptyRequested = output<void>();

  /** One confirmation per row: the id awaiting it, or `null`. */
  protected readonly confirmingPurge = signal<string | null>(null);
  protected readonly confirmingEmpty = signal(false);

  protected readonly rows = computed<readonly TrashRow[]>(() => {
    const now = this.clock.now();

    return this.notes().map((note) => ({
      note,
      snippet: note.content.split('\n').slice(0, SNIPPET_LINES).join('\n'),
      snippetKey: note.kind === 'checklist' ? 'trash.checklistNote' : null,
      deletedRef: relativeTimeRef(note.deletedAt, now),
      purgeRef: purgeRef(note.purgeAt, now),
    }));
  });

  protected onPurgeClick(id: string): void {
    if (this.confirmingPurge() !== id) {
      this.confirmingPurge.set(id);
      return;
    }
    this.confirmingPurge.set(null);
    this.purgeRequested.emit(id);
  }

  protected onEmptyClick(): void {
    if (!this.confirmingEmpty()) {
      this.confirmingEmpty.set(true);
      return;
    }
    this.confirmingEmpty.set(false);
    this.emptyRequested.emit();
  }
}

/** Rounded **up**: "erased in 1 d" while there is any time left. */
function purgeRef(purgeAt: Date, now: Date): TranslationRef {
  const days = Math.ceil((purgeAt.getTime() - now.getTime()) / MS_PER_DAY);

  return days <= 0 ? { key: 'trash.purgesToday' } : { key: 'trash.purgesIn', params: { count: days } };
}
