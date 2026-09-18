import { EnvironmentProviders, Provider } from '@angular/core';
import { TRANSLOCO_TRANSPILER, provideTransloco } from '@jsverse/transloco';
import { PluralTranspiler } from '@core/services/i18n/plural-transpiler';
import { AppTranslocoLoader } from '@core/services/i18n/transloco-loader';

/**
 * The bundled loader is already synchronous, so no `TranslocoTestingModule` is needed.
 *
 * ⚠️ The plural transpiler comes with it, exactly as `app.config.ts` provides it: without it
 * a spec asserting on a counted string reads the ICU source back instead of a sentence.
 */
export function provideTranslocoTesting(): (EnvironmentProviders | Provider)[] {
  return [
    ...provideTransloco({
      config: {
        availableLangs: ['fr', 'en'],
        defaultLang: 'fr',
        reRenderOnLangChange: true,
        missingHandler: { logMissingKey: false, useFallbackTranslation: false, allowEmpty: true },
      },
      loader: AppTranslocoLoader,
    }),
    { provide: TRANSLOCO_TRANSPILER, useClass: PluralTranspiler },
  ];
}
