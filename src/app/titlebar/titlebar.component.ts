import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { APP_INFO } from '@core/services/app-info/app-info.service';
import { APP_LOCALES } from '@core/services/i18n/locale.model';
import { LocaleService } from '@core/services/i18n/locale.service';
import { VaultStore } from '@core/state/vault.store';
import { AboutMenuComponent } from './about-menu/about-menu.component';
import { FileMenuComponent } from './file-menu/file-menu.component';

@Component({
  selector: 'app-titlebar',
  imports: [TranslocoPipe, FileMenuComponent, AboutMenuComponent],
  templateUrl: './titlebar.component.html',
  styleUrl: './titlebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TitlebarComponent {
  protected readonly title = APP_INFO.name;

  protected readonly locales = APP_LOCALES;
  protected readonly localeService = inject(LocaleService);
  protected readonly vault = inject(VaultStore);
}
