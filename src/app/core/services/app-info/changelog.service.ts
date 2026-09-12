import { Injectable } from '@angular/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { commands } from '@core/ipc/bindings';
import type { ChangelogRelease, ChangelogSection } from '@core/ipc/bindings';
import { APP_INFO } from './app-info.service';

export type { ChangelogRelease, ChangelogSection };

/**
 * ⚠️ Must stay covered by the scope declared for `opener:allow-open-url` in
 * `src-tauri/capabilities/default.json`, or opening is refused at runtime.
 */
export const RELEASES_URL = `${APP_INFO.repository}/releases`;

/**
 * A seam, like `UpdaterService` and `AppInfoService`: the dialog stays testable in jsdom,
 * which has neither a Tauri bridge nor the `opener` plugin.
 *
 * Not a `resource` held here: nothing needs the changelog until someone opens the panel.
 */
@Injectable({ providedIn: 'root' })
export class ChangelogService {
  /**
   * Newest release first. Rejects when there is no bridge to ask — the dialog says so
   * rather than showing an empty sheet.
   */
  async load(): Promise<readonly ChangelogRelease[]> {
    // A command without a `Result` on the Rust side: reading an embedded string cannot fail.
    return commands.appChangelog();
  }

  /** Opens the releases page in the system browser, outside the WebView. */
  async openReleases(): Promise<void> {
    await openUrl(RELEASES_URL);
  }
}
