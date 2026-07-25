import { Injectable, Signal, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

/** Langues d'affichage de l'interface — sans rapport avec `LanguageTag` (langage de coloration des notes). */
export const APP_LOCALES = ['fr', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

const STORAGE_KEY = 'devbox.locale';

function isAppLocale(value: string | null): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value ?? '');
}

/** Langue active de l'UI : source de vérité déléguée à Transloco, persistée en local. */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly transloco = inject(TranslocoService);

  readonly activeLocale: Signal<string> = this.transloco.activeLang;

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isAppLocale(stored)) {
      this.transloco.setActiveLang(stored);
    }
  }

  setLocale(locale: AppLocale): void {
    this.transloco.setActiveLang(locale);
    localStorage.setItem(STORAGE_KEY, locale);
  }
}
