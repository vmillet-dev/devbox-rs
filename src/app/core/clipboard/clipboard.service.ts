import { InjectionToken, Injectable, inject } from '@angular/core';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { StatusNotifier } from '@core/notifications/status.service';
import { SettingsStore } from '@core/settings/settings.store';

/**
 * All this service needs from the plugin. A token rather than a direct call,
 * for the same practical reason as `PREFERENCES_STORE_LOADER`.
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
 * The system clipboard. The CSP locks the WebView to `'self'` and
 * `navigator.clipboard` is unusable there: everything goes through the plugin.
 *
 * Outside Tauri (jsdom) the plugin throws. A failed copy must neither bring the
 * application down nor surface an unhandled error, hence the success boolean
 * rather than an exception.
 *
 * ⚠️ The copy acknowledgement is placed **here** and not in the callers: there
 * are five of them, and a single point is what makes it settable by one boolean.
 */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly adapter = inject(CLIPBOARD_ADAPTER);
  private readonly notifier = inject(StatusNotifier);
  private readonly settings = inject(SettingsStore);

  async copy(value: string): Promise<boolean> {
    try {
      await this.adapter.writeText(value);
    } catch {
      return false;
    }

    // Callers with something better to say — "3 notes copied as Markdown" —
    // speak afterwards: the banner keeps only the last message.
    if (this.settings.copyConfirmation()) {
      this.notifier.notify({ key: 'settings.copied' });
    }

    return true;
  }

  /** An empty string for an empty clipboard as for an impossible read: either way there is nothing to capture. */
  async paste(): Promise<string> {
    try {
      return (await this.adapter.readText()) ?? '';
    } catch {
      return '';
    }
  }
}
