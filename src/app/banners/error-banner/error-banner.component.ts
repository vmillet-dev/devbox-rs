import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ErrorNotifier } from '@core/errors/error-notifier.service';

/**
 * The global error banner. On a desktop app the console is not an interface: a
 * failed write or an uncaught exception has to be visible, or the application
 * simply appears to ignore the action.
 */
@Component({
  selector: 'app-error-banner',
  imports: [TranslocoPipe],
  templateUrl: './error-banner.component.html',
  styleUrl: './error-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorBannerComponent {
  protected readonly notifier = inject(ErrorNotifier);
}
