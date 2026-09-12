import { InjectionToken, Injectable, inject } from '@angular/core';
import { load } from '@tauri-apps/plugin-store';
import type { Store, StoreOptions } from '@tauri-apps/plugin-store';

/**
 * A token rather than a direct call to `load`: the Angular builder bundles the modules
 * before Vitest sees them, and `vi.mock` on an external package then intercepts only
 * half the time.
 */
type PreferencesStoreLoader = (path: string, options: StoreOptions) => Promise<Store>;

export const PREFERENCES_STORE_LOADER = new InjectionToken<PreferencesStoreLoader>(
  'PREFERENCES_STORE_LOADER',
  { providedIn: 'root', factory: () => load },
);

/** Created in `app_config_dir()`, like the SQLite database. */
const STORE_FILE = 'preferences.json';

/** A preference toggles on a click, never in a burst. */
const AUTO_SAVE_MS = 300;

/**
 * Backed by `tauri-plugin-store`: a real file, immune to a WebView wipe unlike the
 * `localStorage` it replaces.
 *
 * ⚠️ The API stays **synchronous** where the plugin's is not: a preference is read when a
 * component is constructed, and an async `read` would show the interface in one state
 * then the other. Outside Tauri (jsdom), it degrades to a memory cache.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly load = inject(PREFERENCES_STORE_LOADER);
  private readonly cache = new Map<string, string>();
  private store: Store | null = null;

  /**
   * Call **before** the first read, which would otherwise answer `null`. Values from an
   * earlier version still in `localStorage` are adopted: without this, an upgrade would
   * reset the interface language.
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
      // Plugin unavailable: the memory cache runs the session, which simply
      // will not survive a restart.
    }
  }

  read(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.cache.set(key, value);
    // Not awaited: the caller is toggling an interface state.
    void this.store?.set(key, value).catch(() => undefined);
  }

  private adoptLegacyValues(): void {
    const adopted: string[] = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        // Our keys only: dumping everything would pollute the preferences file for good.
        if (!key?.startsWith('devbox.') || this.cache.has(key)) continue;

        const value = localStorage.getItem(key);
        if (value === null) continue;

        this.cache.set(key, value);
        void this.store?.set(key, value).catch(() => undefined);
        adopted.push(key);
      }
    } catch {
      // `localStorage` throws in private browsing. Nothing to adopt, nothing to do.
      return;
    }

    // Only what was adopted: a `clear()` would also take the keys this loop refused to
    // read.
    for (const key of adopted) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Harmless: the adoption already happened on the file side.
      }
    }
  }
}
