import { InjectionToken, Injectable, inject } from '@angular/core';
import { load } from '@tauri-apps/plugin-store';
import type { Store, StoreOptions } from '@tauri-apps/plugin-store';

/**
 * Tout ce que ce service attend du plugin : ouvrir un fichier. Un jeton plutôt
 * qu'un appel direct à `load`, aussi par nécessité pratique — le builder
 * Angular regroupe les modules avant que Vitest ne les voie, et `vi.mock` sur un
 * paquet externe n'intercepte alors qu'une fois sur deux.
 */
type PreferencesStoreLoader = (path: string, options: StoreOptions) => Promise<Store>;

export const PREFERENCES_STORE_LOADER = new InjectionToken<PreferencesStoreLoader>(
  'PREFERENCES_STORE_LOADER',
  { providedIn: 'root', factory: () => load },
);

/** Créé dans `app_config_dir()`, au même titre que la base SQLite. */
const STORE_FILE = 'preferences.json';

/** Une préférence bascule par clic, jamais en rafale. */
const AUTO_SAVE_MS = 300;

/**
 * Préférences locales (langue de l'UI, plein écran de l'éditeur), adossées à
 * `tauri-plugin-store` : un vrai fichier, insensible à un vidage du WebView
 * contrairement au `localStorage` qu'il remplace.
 *
 * L'API reste **synchrone** alors que celle du plugin ne l'est pas : une
 * préférence est lue à la construction d'un composant, et un `read` asynchrone
 * ferait apparaître l'interface dans un état puis dans l'autre. Le fichier est
 * donc chargé une fois par [`hydrate`], et les écritures partent sans être
 * attendues — une préférence non persistée ne doit ni faire tomber
 * l'application ni la faire patienter.
 *
 * Hors Tauri (jsdom), `load` échoue et le service dégrade en cache mémoire.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly load = inject(PREFERENCES_STORE_LOADER);
  private readonly cache = new Map<string, string>();
  private store: Store | null = null;

  /**
   * Charge le fichier et remplit le cache. À appeler **avant** la première
   * lecture, qui rendrait sinon `null`.
   *
   * Les valeurs d'une version antérieure encore dans `localStorage` sont
   * reprises : sans ça, la mise à jour réinitialiserait la langue de l'interface.
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
      // Plugin indisponible : le cache mémoire fait tourner la session, elle ne
      // survivra simplement pas au redémarrage.
    }
  }

  read(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.cache.set(key, value);
    // Non attendu : l'appelant bascule un état d'interface.
    void this.store?.set(key, value).catch(() => undefined);
  }

  private adoptLegacyValues(): void {
    let migrated = false;
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        // Seules nos clés : le WebView peut en porter d'autres, et tout
        // déverser polluerait durablement le fichier de préférences.
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
