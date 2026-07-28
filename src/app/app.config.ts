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
import { provideDataAccess } from '@core/data/data.providers';
import { AppErrorHandler } from '@core/errors/app-error-handler';
import { APP_LOCALES, DEFAULT_LOCALE, LocaleService } from '@core/i18n/locale.service';
import { AppTranslocoLoader } from '@core/i18n/transloco-loader';
import { provideUpdateCheck } from '@core/updates/update.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),

    // Routage par fragment : les fichiers sont servis depuis le protocole
    // interne de Tauri, où une URL profonde rechargée n'a pas de serveur pour
    // la réécrire vers index.html. Le fragment évite entièrement le problème.
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
    provideAppInitializer(() => inject(LocaleService).restore()),

    // Liaison des dépôts vers le backend Rust : voir core/data/data.providers.ts.
    ...provideDataAccess(),

    // Recherche de mise à jour au lancement, sans bloquer le démarrage.
    provideUpdateCheck(),

    { provide: ErrorHandler, useClass: AppErrorHandler },
  ],
};
