import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from "@angular/core";
import { provideRouter } from "@angular/router";

import { routes } from "./app.routes";
import { NOTES_REPOSITORY } from "./core/data/notes-repository.token";
import { MockNotesRepository } from "./core/data/mock-notes-repository";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // À remplacer par une implémentation basée sur `invoke()` (Tauri/Rust)
    // une fois le backend des notes disponible : voir notes-repository.token.ts
    { provide: NOTES_REPOSITORY, useClass: MockNotesRepository },
  ],
};
