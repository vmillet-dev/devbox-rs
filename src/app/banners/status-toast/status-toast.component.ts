import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { StatusNotifier } from '@core/notifications/status.service';

/**
 * In the same place as the error banner, and for the same reason: without something on
 * screen, an import that adds nothing looks like an application that did nothing.
 */
@Component({
  selector: 'app-status-toast',
  imports: [TranslocoPipe],
  templateUrl: './status-toast.component.html',
  styleUrl: './status-toast.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusToastComponent {
  protected readonly notifier = inject(StatusNotifier);
}
