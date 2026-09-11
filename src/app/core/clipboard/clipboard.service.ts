import { InjectionToken, Injectable, inject } from '@angular/core';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { StatusNotifier } from '@core/notifications/status.service';
import { SettingsStore } from '@core/settings/settings.store';

/** A token rather than a direct call, for the same reason as `PREFERENCES_STORE_LOADER`. */
export interface ClipboardAdapter {
  readText(): Promise<string | null>;
  writeText(value: string): Promise<void>;
}

export const CLIPBOARD_ADAPTER = new InjectionToken<ClipboardAdapter>('CLIPBOARD_ADAPTER', {
  providedIn: 'root',
  factory: () => ({ readText, writeText }),
});

/**
 * The CSP locks the WebView to `'self'` and `navigator.clipboard` is unusable there:
 * everything goes through the plugin, which throws outside Tauri — hence the success
 * boolean rather than an exception.
 *
 * ⚠️ The copy acknowledgement is placed **here** and not in the five callers, which is
 * what makes it settable by one boolean.
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

    // Callers with something better to say speak afterwards: the banner keeps the last.
    if (this.settings.copyConfirmation()) {
      this.notifier.notify({ key: 'settings.copied' });
    }

    return true;
  }

  /** An empty string for an empty clipboard as for an impossible read. */
  async paste(): Promise<string> {
    try {
      return (await this.adapter.readText()) ?? '';
    } catch {
      return '';
    }
  }
}
