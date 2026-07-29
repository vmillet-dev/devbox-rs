import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ErrorNotifier } from '@core/errors/error-notifier.service';

/**
 * Bandeau d'erreur global. Sur une app de bureau, la console n'est pas une
 * interface : un échec d'écriture ou une exception non rattrapée doit être
 * visible, sinon l'application semble simplement ignorer l'action.
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
