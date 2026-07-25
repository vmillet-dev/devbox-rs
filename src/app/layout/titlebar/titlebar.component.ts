import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { APP_LOCALES, LocaleService } from '@core/i18n/locale.service';

@Component({
  selector: 'app-titlebar',
  imports: [TranslocoPipe],
  templateUrl: './titlebar.component.html',
  styleUrl: './titlebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitlebarComponent {
  readonly title = input('DevBox');

  protected readonly locales = APP_LOCALES;
  protected readonly localeService = inject(LocaleService);
}
