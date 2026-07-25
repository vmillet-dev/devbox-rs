import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteLifecycle } from '@core/models/note.model';
import { TranslationRef } from '@core/models/translation-ref.model';
import { ClockService } from '@core/time/clock.service';
import { expiryRef, isExpiringSoon } from '@core/utils/relative-time.util';

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

  protected readonly icon = computed(() => (this.lifecycle().kind === 'permanent' ? '📌' : '⏳'));

  protected readonly label = computed<TranslationRef>(() => {
    const lifecycle = this.lifecycle();
    return lifecycle.kind === 'permanent'
      ? { key: 'lifecycle.neverExpires' }
      : expiryRef(lifecycle.at, this.clock.now());
  });

  protected readonly stale = computed(() => {
    const lifecycle = this.lifecycle();
    return lifecycle.kind === 'expires' && isExpiringSoon(lifecycle.at, this.clock.now());
  });
}
