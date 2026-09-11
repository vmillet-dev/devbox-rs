import { EnvironmentProviders } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { AppTranslocoLoader } from '@core/i18n/transloco-loader';

/**
 * The same Transloco providers as the real app — the bundled loader is already
 * synchronous, so no `TranslocoTestingModule` is needed.
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
