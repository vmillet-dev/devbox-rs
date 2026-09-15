import { EnvironmentProviders } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { AppTranslocoLoader } from '@core/services/i18n/transloco-loader';

/** The bundled loader is already synchronous, so no `TranslocoTestingModule` is needed. */
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
