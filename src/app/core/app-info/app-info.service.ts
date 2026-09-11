import { Injectable, Signal, computed, resource } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * ⚠️ Must stay covered by the scope declared for `opener:allow-open-url` in
 * `src-tauri/capabilities/default.json`, or opening is refused at runtime.
 */
export const REPOSITORY_URL = 'https://github.com/vmillet-dev/devbox-rs';

export const AUTHOR_NAME = 'Valentin MILLET';
export const AUTHOR_HANDLE = '@vmillet-dev';

/** The name shown in the titlebar. */
export const APP_NAME = 'DevBox';

/**
 * The seam to the Tauri APIs that describe the application. Same reason to
 * exist as `UpdaterService`: these are core and plugin commands, absent from
 * `bindings.ts`, and a component importing them would become untestable —
 * jsdom has no Tauri bridge.
 *
 * No description here: that is visible text, and so a translation key.
 */
@Injectable({ providedIn: 'root' })
export class AppInfoService {
  private readonly versionResource = resource({ loader: () => getVersion() });

  /**
   * The version from `tauri.conf.json`, which the `check-version` CI job keeps
   * aligned with the tag. `null` outside the Tauri runtime (`ng serve` alone):
   * the card then shows a dash rather than lying.
   */
  readonly version: Signal<string | null> = computed(() =>
    this.versionResource.hasValue() ? this.versionResource.value() : null,
  );

  /** Opens the repository in the system browser, outside the WebView. */
  async openRepository(): Promise<void> {
    await openUrl(REPOSITORY_URL);
  }
}
