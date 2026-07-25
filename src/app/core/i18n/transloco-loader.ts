import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import fr from '../../../assets/i18n/fr.json';
import en from '../../../assets/i18n/en.json';

const TRANSLATIONS: Record<string, Translation> = { fr, en };

/**
 * Traductions embarquées au build plutôt que chargées en HTTP : l'app est un
 * petit binaire desktop avec seulement deux langues, inutile d'introduire
 * HttpClient et une requête réseau juste pour ça.
 */
@Injectable({ providedIn: 'root' })
export class AppTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(TRANSLATIONS[lang] ?? {});
  }
}
