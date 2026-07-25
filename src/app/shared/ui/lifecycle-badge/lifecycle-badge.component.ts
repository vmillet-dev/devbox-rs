import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteLifecycle } from '../../../core/models/note.model';
import { TranslationRef, expiryRef, isExpiringSoon } from '../../../core/utils/relative-time.util';

@Component({
  selector: 'app-lifecycle-badge',
  imports: [TranslocoPipe],
  templateUrl: './lifecycle-badge.component.html',
  styleUrl: './lifecycle-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LifecycleBadgeComponent {
  readonly lifecycle = input.required<NoteLifecycle>();

  protected readonly icon = computed(() => (this.lifecycle().kind === 'permanent' ? '📌' : '⏳'));

  protected readonly label = computed<TranslationRef>(() => {
    const lifecycle = this.lifecycle();
    return lifecycle.kind === 'permanent' ? { key: 'lifecycle.neverExpires' } : expiryRef(lifecycle.at);
  });

  protected readonly stale = computed(() => {
    const lifecycle = this.lifecycle();
    return lifecycle.kind === 'expires' && isExpiringSoon(lifecycle.at);
  });
}
