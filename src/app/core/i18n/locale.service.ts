import { Injectable, Signal, computed, effect, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { PreferencesService } from '../preferences/preferences.service';

/** The UI display languages — unrelated to `LanguageTag`, which colours notes. */
export const APP_LOCALES = ['fr', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'fr';

const STORAGE_KEY = 'devbox.locale';

function isAppLocale(value: string | null): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value ?? '');
}

/** The active UI language: the source of truth is Transloco's, persisted locally. */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly transloco = inject(TranslocoService);
  private readonly preferences = inject(PreferencesService);

  readonly activeLocale: Signal<AppLocale> = computed(() => {
    const active = this.transloco.activeLang();
    return isAppLocale(active) ? active : DEFAULT_LOCALE;
  });

  constructor() {
    // `<html lang>` drives screen-reader pronunciation and typographic rules.
    effect(() => {
      document.documentElement.lang = this.activeLocale();
    });
  }

  /**
   * Called from a `provideAppInitializer`, so before the first render: otherwise the
   * interface would briefly appear in the default language.
   */
  restore(): void {
    const stored = this.preferences.read(STORAGE_KEY);
    if (isAppLocale(stored)) {
      this.transloco.setActiveLang(stored);
    }
  }

  setLocale(locale: AppLocale): void {
    this.transloco.setActiveLang(locale);
    this.preferences.write(STORAGE_KEY, locale);
  }
}
