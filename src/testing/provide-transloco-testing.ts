import { EnvironmentProviders } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { AppTranslocoLoader } from '../app/core/i18n/transloco-loader';

/**
 * Mêmes providers Transloco que l'app réelle (le loader embarqué est déjà
 * synchrone, pas besoin d'un `TranslocoTestingModule` séparé) : à spread dans
 * le `providers` de `TestBed.configureTestingModule` pour tout composant
 * dont le template (ou celui d'un enfant réel) utilise le pipe `transloco`.
 */
export function provideTranslocoTesting(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['fr', 'en'],
      defaultLang: 'fr',
      reRenderOnLangChange: true,
      missingHandler: { logMissingKey: false, useFallbackTranslation: false, allowEmpty: true },
    },
    loader: AppTranslocoLoader,
  });
}
