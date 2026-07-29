import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { APP_NAME } from '@core/app-info/app-info.service';
import { APP_LOCALES, LocaleService } from '@core/i18n/locale.service';
import { AboutMenuComponent } from '../about-menu/about-menu.component';

@Component({
  selector: 'app-titlebar',
  imports: [TranslocoPipe, AboutMenuComponent],
  templateUrl: './titlebar.component.html',
  styleUrl: './titlebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitlebarComponent {
  protected readonly title = APP_NAME;

  protected readonly locales = APP_LOCALES;
  protected readonly localeService = inject(LocaleService);
}
