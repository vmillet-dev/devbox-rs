import { InjectionToken, Injectable, inject } from '@angular/core';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * Tout ce que ce service attend du plugin. Un jeton plutôt qu'un appel direct,
 * pour la même raison pratique que `PREFERENCES_STORE_LOADER` : le builder
 * Angular regroupe les modules avant que Vitest ne les voie, et `vi.mock` sur un
 * paquet externe n'intercepte alors qu'une fois sur deux.
 */
export interface ClipboardAdapter {
  readText(): Promise<string | null>;
  writeText(value: string): Promise<void>;
}

export const CLIPBOARD_ADAPTER = new InjectionToken<ClipboardAdapter>('CLIPBOARD_ADAPTER', {
  providedIn: 'root',
  factory: () => ({ readText, writeText }),
});

/**
 * Presse-papier système. Le CSP verrouille la WebView sur `'self'` et
 * `navigator.clipboard` y est inutilisable : tout passe par le plugin Tauri.
 *
 * Hors Tauri (jsdom), le plugin lève. Une copie qui échoue ne doit ni faire
 * tomber l'application ni remonter une erreur non gérée, d'où le booléen de
 * succès plutôt qu'une exception : l'appelant n'a qu'un retour visuel à décider.
 */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly adapter = inject(CLIPBOARD_ADAPTER);

  async copy(value: string): Promise<boolean> {
    try {
      await this.adapter.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  /** Chaîne vide aussi bien pour un presse-papier vide que pour une lecture impossible : dans les deux cas il n'y a rien à capturer. */
  async paste(): Promise<string> {
    try {
      return (await this.adapter.readText()) ?? '';
    } catch {
      return '';
    }
  }
}
