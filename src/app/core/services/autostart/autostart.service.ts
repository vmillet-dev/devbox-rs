import { InjectionToken, Injectable, Injector, effect, inject } from '@angular/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { SettingsStore } from '@core/services/settings/settings.store';

/** A token rather than a direct call, for the same reason as `PREFERENCES_STORE_LOADER`. */
export interface AutostartAdapter {
  enable(): Promise<void>;
  disable(): Promise<void>;
  isEnabled(): Promise<boolean>;
}

export const AUTOSTART_ADAPTER = new InjectionToken<AutostartAdapter>('AUTOSTART_ADAPTER', {
  providedIn: 'root',
  factory: () => ({ enable, disable, isEnabled }),
});

/**
 * ⚠️ The real state belongs to the system and not to the preferences file: at startup we
 * read the system and align the preference to it. Without that read-back, disabling
 * autostart from the task manager would leave the box ticked — and DevBox would re-enable
 * it on the next setting change.
 */
@Injectable({ providedIn: 'root' })
export class AutostartService {
  private readonly adapter = inject(AUTOSTART_ADAPTER);
  private readonly settings = inject(SettingsStore);
  private readonly injector = inject(Injector);

  /**
   * Aligns the preference with what the system declares, then follows every change. Never
   * rejects: an autostart that cannot be set must not stop the application from opening.
   */
  async start(): Promise<void> {
    try {
      this.settings.setStartWithSystem(await this.adapter.isEnabled());
    } catch {
      // Outside Tauri, or plugin unavailable: the preference keeps its value.
    }

    effect(
      () => {
        void this.push(this.settings.startWithSystem());
      },
      { injector: this.injector },
    );
  }

  private async push(enabled: boolean): Promise<void> {
    try {
      // Read back first: `enable()` would rewrite the system entry on every
      // start, and on macOS a re-registered agent loses its state.
      if ((await this.adapter.isEnabled()) === enabled) return;

      await (enabled ? this.adapter.enable() : this.adapter.disable());
    } catch {
      // Same: the failure is silent, the box stays what the user set.
    }
  }
}
