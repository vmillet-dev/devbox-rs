import { Injectable, Signal, computed, effect, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { PreferencesService } from '../preferences/preferences.service';

/** Langues d'affichage de l'interface — sans rapport avec `LanguageTag` (langage de coloration des notes). */
export const APP_LOCALES = ['fr', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'fr';

const STORAGE_KEY = 'devbox.locale';

function isAppLocale(value: string | null): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value ?? '');
}

/** Langue active de l'UI : source de vérité déléguée à Transloco, persistée en local. */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly transloco = inject(TranslocoService);
  private readonly preferences = inject(PreferencesService);

  readonly activeLocale: Signal<AppLocale> = computed(() => {
    const active = this.transloco.activeLang();
    return isAppLocale(active) ? active : DEFAULT_LOCALE;
  });

  constructor() {
    // `<html lang>` doit suivre la langue affichée : c'est ce qui pilote la
    // prononciation des lecteurs d'écran et les règles typographiques du moteur de rendu.
    effect(() => {
      document.documentElement.lang = this.activeLocale();
    });
  }

  /**
   * Restaure la langue choisie lors d'une précédente session.
   * Invoquée depuis un `provideAppInitializer`, donc avant le premier rendu :
   * sinon l'interface apparaîtrait brièvement dans la langue par défaut.
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
