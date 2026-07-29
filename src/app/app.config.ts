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
import { AppErrorHandler } from '@core/errors/app-error-handler';
import { APP_LOCALES, DEFAULT_LOCALE, LocaleService } from '@core/i18n/locale.service';
import { AppTranslocoLoader } from '@core/i18n/transloco-loader';
import { PreferencesService } from '@core/preferences/preferences.service';
import { TrayService } from '@core/tray/tray.service';
import { UpdateStore } from '@core/updates/update.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),

    // Routage par fragment : les fichiers sont servis depuis le protocole
    // interne de Tauri, où une URL profonde rechargée n'a pas de serveur pour la
    // réécrire vers index.html.
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

    // Un seul initialiseur pour les deux étapes, et non deux enchaînés : Angular
    // les lance ensemble et n'attend leurs promesses qu'en bloc, donc
    // `restore()` lirait un cache encore vide.
    provideAppInitializer(async () => {
      const preferences = inject(PreferencesService);
      const locale = inject(LocaleService);
      const tray = inject(TrayService);

      await preferences.hydrate();
      locale.restore();
      // Après `restore()` : c'est le front qui crée la barre système, en lui
      // donnant ses libellés, et la créer avant aurait affiché la langue par
      // défaut le temps d'un aller-retour.
      tray.start();
    }),

    // Recherche de mise à jour au lancement. La promesse n'est délibérément pas
    // retournée : Angular attend celles d'un initialiseur, et l'application
    // resterait sur un écran vide le temps d'un appel réseau — indéfiniment si
    // l'endpoint ne répond pas. La pop-in apparaît quand la réponse arrive.
    provideAppInitializer(() => {
      void inject(UpdateStore).check();
    }),

    { provide: ErrorHandler, useClass: AppErrorHandler },
  ],
};
