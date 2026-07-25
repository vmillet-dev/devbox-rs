import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from "@angular/core";
import { provideRouter } from "@angular/router";
import { provideTransloco } from "@jsverse/transloco";

import { routes } from "./app.routes";
import { NOTES_REPOSITORY } from "./core/data/notes-repository.token";
import { MockNotesRepository } from "./core/data/mock-notes-repository";
import { AppTranslocoLoader } from "./core/i18n/transloco-loader";
import { APP_LOCALES, LocaleService } from "./core/i18n/locale.service";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideTransloco({
      config: {
        availableLangs: [...APP_LOCALES],
        defaultLang: "fr",
        reRenderOnLangChange: true,
      },
      loader: AppTranslocoLoader,
    }),
    // Résout la langue persistée avant le premier rendu, pour éviter un flash en français.
    provideAppInitializer(() => {
      inject(LocaleService);
    }),
    // À remplacer par une implémentation basée sur `invoke()` (Tauri/Rust)
    // une fois le backend des notes disponible : voir notes-repository.token.ts
    { provide: NOTES_REPOSITORY, useClass: MockNotesRepository },
  ],
};
