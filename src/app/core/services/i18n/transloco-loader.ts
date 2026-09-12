import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { APP_INFO } from '@core/app-info/app-info.service';
import en from './translations/en.json';
import fr from './translations/fr.json';

const TRANSLATIONS: Record<string, Translation> = { fr, en };

/**
 * Translations bundled at build time rather than fetched over HTTP: two languages in a
 * small desktop binary, where HttpClient plus a network request would be waste.
 *
 * The files deliberately live outside `src/assets`: the asset glob would copy them into
 * `dist`, where they would ship a second time and never be read.
 */
@Injectable({ providedIn: 'root' })
export class AppTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    // `app` is not a string anyone reads: it is what `{{app}}` resolves to. Transloco's
    // transpiler falls back to a sibling key when an interpolation is not in the params,
    // so the name reaches every string without a call site passing it.
    return of({ ...(TRANSLATIONS[lang] ?? {}), app: APP_INFO.name });
  }
}
