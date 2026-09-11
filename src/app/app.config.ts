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
import { AutostartService } from '@core/autostart/autostart.service';
import { PreferencesService } from '@core/preferences/preferences.service';
import { SettingsStore } from '@core/settings/settings.store';
import { GlobalShortcutsService } from '@core/shortcuts/global-shortcuts.service';
import { TrayService } from '@core/tray/tray.service';
import { UpdateStore } from '@core/updates/update.store';
import { WindowBehaviorService } from '@core/window/window-behavior.service';

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
      // ⚠️ Tout est injecté **avant** le premier `await` : un `inject()` placé
      // après sort du contexte d'injection et fait échouer le démarrage
      // (NG0203), écran noir à la clé.
      const preferences = inject(PreferencesService);
      const locale = inject(LocaleService);
      const settings = inject(SettingsStore);
      const tray = inject(TrayService);
      const shortcuts = inject(GlobalShortcutsService);
      const windowBehavior = inject(WindowBehaviorService);
      const autostart = inject(AutostartService);

      await preferences.hydrate();
      locale.restore();
      // Avant le premier rendu : lire après ferait apparaître l'interface dans
      // un thème puis dans l'autre.
      settings.restore();
      // Après `restore()` : c'est le front qui crée la barre système, en lui
      // donnant ses libellés, et la créer avant aurait affiché la langue par
      // défaut le temps d'un aller-retour.
      tray.start();

      // Après `settings.restore()` aussi : ces trois-là suivent une préférence,
      // et partir sur la valeur par défaut enverrait au natif un réglage que
      // l'utilisateur avait changé — le temps d'une bascule visible.
      //
      // Un raccourci déjà pris par une autre application ne fait rien et ne dit
      // rien : ce service est ce qui le signale.
      shortcuts.start();
      windowBehavior.start();
      // Pas attendu : l'état réel appartient au système, et l'interroger ne doit
      // pas retarder le premier rendu.
      void autostart.start();
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
