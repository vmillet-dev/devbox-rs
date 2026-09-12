import { InjectionToken, Injectable, inject } from '@angular/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { OpenDialogOptions, SaveDialogOptions } from '@tauri-apps/plugin-dialog';
import { APP_INFO } from '@core/services/app-info/app-info.service';

/**
 * A token rather than a direct call, for the same practical reason as `CLIPBOARD_ADAPTER`:
 * the Angular builder bundles the modules before Vitest sees them.
 */
export interface FileDialogAdapter {
  open(options: OpenDialogOptions): Promise<string | string[] | null>;
  save(options: SaveDialogOptions): Promise<string | null>;
}

export const FILE_DIALOG_ADAPTER = new InjectionToken<FileDialogAdapter>('FILE_DIALOG_ADAPTER', {
  providedIn: 'root',
  factory: () => ({ open, save }),
});

/** The exchange format's filter, shared by import and export. */
const BUNDLE_FILTER = { name: APP_INFO.name, extensions: ['json'] };

/**
 * `null` covers both a cancellation and the plugin being unavailable (outside Tauri it
 * throws): either way the caller has nothing to open, and an exception would force it to
 * tell two non-choices apart.
 */
@Injectable({ providedIn: 'root' })
export class FileDialogService {
  private readonly adapter = inject(FILE_DIALOG_ADAPTER);

  async pickBundle(): Promise<string | null> {
    return this.pick({ multiple: false, filters: [BUNDLE_FILTER] });
  }

  async pickAttachment(): Promise<string | null> {
    return this.pick({ multiple: false });
  }

  async chooseBundleDestination(defaultPath: string): Promise<string | null> {
    return this.destination({ defaultPath, filters: [BUNDLE_FILTER] });
  }

  /** No filter: an attachment can be of any type. */
  async chooseDestination(defaultPath: string): Promise<string | null> {
    return this.destination({ defaultPath });
  }

  private async destination(options: SaveDialogOptions): Promise<string | null> {
    try {
      return await this.adapter.save(options);
    } catch {
      return null;
    }
  }

  /**
   * `multiple: false` is asked of the plugin, but its return type stays a union: the
   * array is ruled out here so callers handle one path only.
   */
  private async pick(options: OpenDialogOptions): Promise<string | null> {
    try {
      const chosen = await this.adapter.open(options);
      if (Array.isArray(chosen)) return chosen[0] ?? null;
      return chosen;
    } catch {
      return null;
    }
  }
}
