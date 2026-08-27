import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/i18n/translation-ref.model';
import { ClockService } from '@core/time/clock.service';
import { relativeTimeRef } from '@core/time/relative-time.util';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { TrashedNote } from '@features/notes/model/note.model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SNIPPET_LINES = 2;

/** Ce que la ligne affiche, résolu une fois pour toutes plutôt qu'en template. */
interface TrashRow {
  readonly note: TrashedNote;
  readonly snippet: string;
  readonly deletedRef: TranslationRef;
  readonly purgeRef: TranslationRef;
}

/**
 * Panneau de la corbeille : restaurer ou effacer pour de bon.
 *
 * L'échéance de purge est calculée à l'affichage et non reçue en libellé — comme
 * les temps relatifs des cartes, elle doit vieillir à l'écran sans aller-retour.
 */
@Component({
  selector: 'app-trash-panel',
  imports: [DialogBackdropDirective, FocusTrapDirective, TranslocoPipe],
  templateUrl: './trash-panel.component.html',
  styleUrl: './trash-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class TrashPanelComponent {
  private readonly clock = inject(ClockService);

  readonly notes = input.required<readonly TrashedNote[]>();
  readonly isLoading = input(false);

  readonly closed = output<void>();
  readonly restoreRequested = output<string>();
  readonly purgeRequested = output<string>();
  readonly emptyRequested = output<void>();

  /** Une confirmation par ligne : l'identifiant en attente, ou `null`. */
  protected readonly confirmingPurge = signal<string | null>(null);
  protected readonly confirmingEmpty = signal(false);

  protected readonly rows = computed<readonly TrashRow[]>(() => {
    const now = this.clock.now();

    return this.notes().map((note) => ({
      note,
      snippet: note.content.split('\n').slice(0, SNIPPET_LINES).join('\n'),
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

/** Arrondi **au supérieur** : « effacée dans 1 j » tant qu'il reste du temps. */
function purgeRef(purgeAt: Date, now: Date): TranslationRef {
  const days = Math.ceil((purgeAt.getTime() - now.getTime()) / MS_PER_DAY);

  return days <= 0 ? { key: 'trash.purgesToday' } : { key: 'trash.purgesIn', params: { count: days } };
}
