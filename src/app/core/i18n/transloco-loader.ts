import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import en from './translations/en.json';
import fr from './translations/fr.json';

const TRANSLATIONS: Record<string, Translation> = { fr, en };

/**
 * Translations bundled at build time rather than fetched over HTTP: the app is
 * a small desktop binary with two languages, and introducing HttpClient plus a
 * network request just for that would be waste.
 *
 * The files deliberately live outside `src/assets`: the asset glob would copy
 * them into `dist`, where they would ship a second time and never be read.
 */
@Injectable({ providedIn: 'root' })
export class AppTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(TRANSLATIONS[lang] ?? {});
  }
}
