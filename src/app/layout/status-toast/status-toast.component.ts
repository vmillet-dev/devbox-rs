import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { StatusNotifier } from '@core/notifications/status.service';

/**
 * The acknowledgement of a successful action, under the titlebar.
 *
 * In the same place as the error banner, and for the same reason: an import
 * that adds nothing, an export that writes a file elsewhere — without something
 * on screen, the application looks like it did nothing.
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
