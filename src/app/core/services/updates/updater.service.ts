import { Injectable } from '@angular/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { Update, check } from '@tauri-apps/plugin-updater';

export interface AvailableUpdate {
  readonly version: string;
  readonly currentVersion: string;
  /**
   * Explicitly `| undefined`: the plugin may omit them, and `exactOptionalPropertyTypes`
   * tells an absent key from a present-but-undefined one.
   */
  readonly notes?: string | undefined;
}

/** Progress between 0 and 1, or `null` when the total size is unknown. */
export type DownloadProgress = number | null;

/**
 * The only way through to the updater plugin: no component or store imports
 * `@tauri-apps/plugin-updater` directly, which is what makes the store testable by
 * doubling this class.
 *
 * ⚠️ The `Update` the plugin returns is a **native resource**: it holds an identifier on
 * the Rust side and must be closed when it is not installed. It is kept here rather than
 * handed to the store, which would only leak it.
 */
@Injectable({ providedIn: 'root' })
export class UpdaterService {
  private pending: Update | null = null;

  /** `null` when the application is already up to date. */
  async check(): Promise<AvailableUpdate | null> {
    await this.discard();

    const update = await check();
    if (!update) return null;

    this.pending = update;
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body,
    };
  }

  /**
   * Downloads then installs the update held by the last `check()`. On Windows the
   * installer stops the application itself, so nothing after this call is guaranteed.
   */
  async install(onProgress: (progress: DownloadProgress) => void): Promise<void> {
    const update = this.pending;
    if (!update) throw new Error('No update pending.');

    let total: number | null = null;
    let downloaded = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          // Absent when the server does not announce it: the bar stays indeterminate.
          total = event.data.contentLength ?? null;
          onProgress(null);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress(total !== null && total > 0 ? downloaded / total : null);
          break;
        case 'Finished':
          onProgress(1);
          break;
      }
    });

    this.pending = null;
  }

  async relaunch(): Promise<void> {
    await relaunch();
  }

  /** Closes the native resource without installing. */
  async discard(): Promise<void> {
    const update = this.pending;
    this.pending = null;
    await update?.close();
  }
}
