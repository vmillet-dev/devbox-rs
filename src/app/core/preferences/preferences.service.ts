import { InjectionToken, Injectable, inject } from '@angular/core';
import { load } from '@tauri-apps/plugin-store';
import type { Store, StoreOptions } from '@tauri-apps/plugin-store';

/**
 * Tout ce que ce service attend du plugin : ouvrir un fichier.
 *
 * Passer par un jeton plutôt que d'appeler `load` directement suit la même règle
 * que `NOTES_REPOSITORY` — le seul point de contact avec l'extérieur est
 * remplaçable. Ici c'est aussi une nécessité pratique : le builder Angular
 * regroupe les modules avant que Vitest ne les voie, et `vi.mock` sur un paquet
 * externe n'intercepte alors qu'une fois sur deux.
 */
export type PreferencesStoreLoader = (path: string, options: StoreOptions) => Promise<Store>;

export const PREFERENCES_STORE_LOADER = new InjectionToken<PreferencesStoreLoader>(
  'PREFERENCES_STORE_LOADER',
  { providedIn: 'root', factory: () => load },
);

/** Fichier créé dans `app_config_dir()` par le plugin — au même titre que la base SQLite. */
const STORE_FILE = 'preferences.json';

/**
 * Délai avant écriture sur disque. Une préférence bascule par clic, jamais en
 * rafale : quelques centaines de millisecondes suffisent à grouper un
 * aller-retour de bouton sans risquer de perdre le dernier état.
 */
const AUTO_SAVE_MS = 300;

/**
 * Préférences locales de l'utilisateur (langue de l'UI, plein écran de l'éditeur).
 *
 * Adossé à `tauri-plugin-store` : un vrai fichier dans le répertoire de
 * configuration de l'application, lisible depuis Rust et insensible à un vidage
 * du WebView — contrairement au `localStorage` qu'il remplace.
 *
 * # Pourquoi l'API reste synchrone
 *
 * Celle du plugin ne l'est pas. Mais une préférence est lue au moment où un
 * composant se construit (`fullscreen` dans l'éditeur, la langue avant le
 * premier rendu) : rendre `read` asynchrone ferait apparaître l'interface dans
 * un état puis dans l'autre. Le fichier est donc chargé **une fois** par
 * [`hydrate`], depuis un `provideAppInitializer`, et les lectures suivantes
 * tapent dans le cache mémoire. Les écritures sont appliquées au cache
 * immédiatement puis poussées sans être attendues : une préférence non
 * persistée ne doit jamais faire tomber l'application, ni la faire patienter.
 *
 * Hors Tauri (tests unitaires en jsdom), `load` échoue : le service dégrade
 * alors en cache purement mémoire, ce qui reste un comportement correct.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly load = inject(PREFERENCES_STORE_LOADER);
  private readonly cache = new Map<string, string>();
  private store: Store | null = null;

  /**
   * Charge le fichier et remplit le cache. À appeler **avant** la première
   * lecture — sans quoi elle rendrait `null` et la préférence serait perdue.
   *
   * Les valeurs déjà présentes dans le `localStorage` d'une version antérieure
   * sont reprises quand le fichier ne les porte pas encore : sans cette reprise,
   * la mise à jour réinitialiserait silencieusement la langue de l'interface.
   */
  async hydrate(): Promise<void> {
    try {
      const store = await this.load(STORE_FILE, { autoSave: AUTO_SAVE_MS });
      for (const [key, value] of await store.entries<unknown>()) {
        if (typeof value === 'string') {
          this.cache.set(key, value);
        }
      }
      this.store = store;
      this.adoptLegacyValues();
    } catch {
      // Plugin indisponible (hors Tauri, permission refusée) : le cache mémoire
      // suffit à faire fonctionner la session, elle ne survivra simplement pas
      // à un redémarrage.
    }
  }

  read(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.cache.set(key, value);
    // Volontairement non attendu : l'appelant bascule un état d'interface, il
    // n'a rien à faire du moment où l'écriture touche le disque.
    void this.store?.set(key, value).catch(() => undefined);
  }

  private adoptLegacyValues(): void {
    let migrated = false;
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        // Seules les clés de l'application sont reprises : le stockage du
        // WebView peut porter autre chose, et tout y déverser polluerait le
        // fichier de préférences durablement.
        if (!key?.startsWith('devbox.') || this.cache.has(key)) continue;

        const value = localStorage.getItem(key);
        if (value === null) continue;

        this.cache.set(key, value);
        void this.store?.set(key, value).catch(() => undefined);
        migrated = true;
      }
    } catch {
      // `localStorage` lève en navigation privée. Rien à reprendre, rien à faire.
      return;
    }

    if (migrated) {
      // L'ancien emplacement n'est plus lu : le laisser en place ferait
      // ressusciter une valeur périmée si la reprise se rejouait un jour.
      try {
        localStorage.clear();
      } catch {
        // Sans gravité : la reprise a déjà eu lieu côté fichier.
      }
    }
  }
}
