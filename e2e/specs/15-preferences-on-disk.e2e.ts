import { browser, expect } from '@wdio/globals';
import { existsSync, readFileSync } from 'node:fs';

import { canvas } from '../pageobjects/canvas.page.js';
import { fileMenu, settings, titlebar } from '../pageobjects/titlebar.page.js';
import { preferencesPath } from '../support/profile.js';

/**
 * The one thing `12-preferences` cannot show, and the reason this file exists.
 *
 * ⚠️ Under the `embedded` driver provider nothing in the suite can restart the
 * application: the WebDriver server lives inside it, so `reloadSession` opens a new
 * session against the same living process. `tauri-plugin-store` holds its values in
 * that process and flushes on a 300 ms debounce, so a reloaded page reads the
 * **in-memory map** — a preference could never touch the disk and every assertion over
 * there would still pass.
 *
 * So the file is read from Node, which is outside the application entirely. That is the
 * whole round trip a unit suite misses: `SettingsStore` → `PreferencesService` →
 * the plugin → `app_config_dir()/preferences.json`.
 *
 * ⚠️ `app_config_dir()` is `%APPDATA%/<identifier>` on Windows — the same folder as the
 * database — but `~/.config/<identifier>` on Linux, where the data lives under
 * `~/.local/share`. `support/profile.ts` computes both.
 */
describe('Preferences reach the disk', () => {
  /** Longer than the plugin's `autoSave` debounce, with room for a slow runner. */
  const FLUSH_MS = 1_500;

  function stored(): Record<string, unknown> {
    const path = preferencesPath();
    if (!existsSync(path)) {
      throw new Error(`no preferences file at ${path}`);
    }
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  }

  before(canvas.open);

  it('writes the file at all, under app_config_dir()', async () => {
    // Sets something rather than trusting an earlier file to have done it: a spec file
    // establishes its own preconditions, because one profile serves the whole run.
    await fileMenu.openPreferences();
    await settings.select(settings.control.theme, 'dark');
    await settings.close();
    await browser.pause(FLUSH_MS);

    expect(existsSync(preferencesPath())).toBe(true);
  });

  it('writes one key per setting, never one serialised object', async () => {
    await fileMenu.openPreferences();
    await settings.select(settings.control.density, 'comfortable');
    await settings.close();
    await browser.pause(FLUSH_MS);

    const file = stored();
    // `SETTINGS_KEYS` is derived from `keyof AppSettings` as `devbox.${key}`: a blob
    // under one key would make a half-written file lose every setting at once.
    expect(file['devbox.theme']).toBe('dark');
    expect(file['devbox.density']).toBe('comfortable');
  });

  it('rewrites the key as the value is changed, with no confirmation step', async () => {
    await fileMenu.openPreferences();
    await settings.select(settings.control.theme, 'light');
    await settings.close();
    await browser.pause(FLUSH_MS);

    // There is no OK anywhere in the panel: closing it is not what saves.
    expect(stored()['devbox.theme']).toBe('light');
  });

  it('stores the locale the titlebar switch chose, like the panel does', async () => {
    await titlebar.setLocale('en');
    await browser.pause(FLUSH_MS);

    expect(stored()['devbox.locale']).toBe('en');
    expect(await titlebar.activeLocale()).toBe('en');
  });

  it('holds values as strings, one codec per setting', async () => {
    const file = stored();
    // `PreferencesService` caches `string` and nothing else — a boolean written as a
    // boolean would be dropped by `hydrate()` on the next launch.
    const notStrings = Object.entries(file)
      .filter(([, value]) => typeof value !== 'string')
      .map(([key]) => key);
    expect(notStrings).toEqual([]);
  });
});
