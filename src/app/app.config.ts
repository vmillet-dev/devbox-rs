import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';

import { routes } from './app.routes';
import { AppErrorHandler } from '@core/services/errors/app-error-handler';
import { APP_LOCALES, DEFAULT_LOCALE } from '@core/services/i18n/locale.model';
import { LocaleService } from '@core/services/i18n/locale.service';
import { AppTranslocoLoader } from '@core/services/i18n/transloco-loader';
import { AutostartService } from '@core/services/autostart/autostart.service';
import { PreferencesService } from '@core/services/preferences/preferences.service';
import { SettingsStore } from '@core/services/settings/settings.store';
import { GlobalShortcutsService } from '@core/services/shortcuts/global-shortcuts.service';
import { TrayService } from '@core/services/tray/tray.service';
import { UpdateStore } from '@core/services/updates/update.store';
import { WindowBehaviorService } from '@core/services/window/window-behavior.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),

    // Hash routing: the files are served from Tauri's internal protocol, where a
    // reloaded deep URL has no server to rewrite it to index.html.
    provideRouter(routes, withHashLocation()),

    provideTransloco({
      config: {
        availableLangs: [...APP_LOCALES],
        defaultLang: DEFAULT_LOCALE,
        fallbackLang: DEFAULT_LOCALE,
        reRenderOnLangChange: true,
      },
      loader: AppTranslocoLoader,
    }),

    // ⚠️ One initialiser for both steps rather than two chained: Angular starts them
    // together and awaits their promises as a block, so `restore()` would read a
    // still-empty cache.
    provideAppInitializer(async () => {
      // ⚠️ Everything is injected before the first `await`: an `inject()` after one
      // leaves the injection context and fails the bootstrap (NG0203).
      const preferences = inject(PreferencesService);
      const locale = inject(LocaleService);
      const settings = inject(SettingsStore);
      const tray = inject(TrayService);
      const shortcuts = inject(GlobalShortcutsService);
      const windowBehavior = inject(WindowBehaviorService);
      const autostart = inject(AutostartService);

      await preferences.hydrate();
      // ⚠️ Before the first render, and before `locale.restore()`, which reads the
      // language out of it.
      settings.restore();
      locale.restore();
      // ⚠️ After `restore()`: the front creates the tray by giving it its labels, and
      // earlier would push the default language and a setting the user had changed.
      tray.start();

      shortcuts.start();
      windowBehavior.start();
      // Not awaited: asking the system must not delay the first render.
      void autostart.start();
    }),

    // ⚠️ The promise is deliberately not returned: Angular awaits an initialiser's, and
    // the application would sit on a blank screen for the length of a network call.
    provideAppInitializer(() => {
      void inject(UpdateStore).check();
    }),

    { provide: ErrorHandler, useClass: AppErrorHandler },
  ],
};
