import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteLifecycle } from '@core/models/note.model';
import { TranslationRef } from '@core/i18n/translation-ref';
import { ClockService } from '@core/time/clock.service';
import { expiryRef } from '@core/utils/relative-time.util';

@Component({
  selector: 'app-lifecycle-badge',
  imports: [TranslocoPipe],
  templateUrl: './lifecycle-badge.component.html',
  styleUrl: './lifecycle-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LifecycleBadgeComponent {
  private readonly clock = inject(ClockService);

  readonly lifecycle = input.required<NoteLifecycle>();

  /**
   * Échéance proche, telle que le back l'a tranchée. Recalculer le seuil ici en
   * ferait un second propriétaire, libre de diverger de celui qui décide de
   * l'indice « à trier bientôt » des sections.
   */
  readonly expiringSoon = input(false);

  protected readonly icon = computed(() => (this.lifecycle().kind === 'permanent' ? '📌' : '⏳'));

  protected readonly label = computed<TranslationRef>(() => {
    const lifecycle = this.lifecycle();
    return lifecycle.kind === 'permanent'
      ? { key: 'lifecycle.neverExpires' }
      : expiryRef(lifecycle.at, this.clock.now());
  });
}
