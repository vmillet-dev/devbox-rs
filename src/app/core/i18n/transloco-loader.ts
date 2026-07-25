import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import en from './translations/en.json';
import fr from './translations/fr.json';

const TRANSLATIONS: Record<string, Translation> = { fr, en };

/**
 * Traductions embarquées au build plutôt que chargées en HTTP : l'app est un
 * petit binaire desktop avec seulement deux langues, inutile d'introduire
 * HttpClient et une requête réseau juste pour ça.
 *
 * Les fichiers vivent volontairement hors de `src/assets` : le glob d'assets
 * les recopierait dans `dist`, où ils seraient livrés une seconde fois sans
 * jamais être lus.
 */
@Injectable({ providedIn: 'root' })
export class AppTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(TRANSLATIONS[lang] ?? {});
  }
}
