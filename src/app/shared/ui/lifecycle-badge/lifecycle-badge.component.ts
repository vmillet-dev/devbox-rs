import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NoteLifecycle } from '../../../core/models/note.model';
import { formatExpiry, isExpiringSoon } from '../../../core/utils/relative-time.util';

@Component({
  selector: 'app-lifecycle-badge',
  templateUrl: './lifecycle-badge.component.html',
  styleUrl: './lifecycle-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LifecycleBadgeComponent {
  readonly lifecycle = input.required<NoteLifecycle>();

  protected readonly icon = computed(() => (this.lifecycle().kind === 'permanent' ? '📌' : '⏳'));

  protected readonly label = computed(() => {
    const lifecycle = this.lifecycle();
    return lifecycle.kind === 'permanent' ? "N'expire jamais" : formatExpiry(lifecycle.at);
  });

  protected readonly stale = computed(() => {
    const lifecycle = this.lifecycle();
    return lifecycle.kind === 'expires' && isExpiringSoon(lifecycle.at);
  });
}
