import { Injectable, Injector, effect, inject } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { SettingsStore } from '@core/settings/settings.store';

/**
 * What the window's close and minimise buttons must do.
 *
 * Pushed to the native side like the tray labels: the preference lives in
 * `preferences.json` on the front side, and reading it back from Rust would be
 * a second source to keep in step. The native side still carries a default —
 * the window can be closed before the front has started.
 *
 * ⚠️ Both settings only hold when there is a tray: without one the native side
 * refuses to hide the window, which would otherwise leave a process nothing
 * can call back.
 */
@Injectable({ providedIn: 'root' })
export class WindowBehaviorService {
  private readonly settings = inject(SettingsStore);
  private readonly injector = inject(Injector);

  start(): void {
    effect(
      () => {
        void this.push({
          closeToTray: this.settings.closeToTray(),
          minimizeToTray: this.settings.minimizeToTray(),
        });
      },
      { injector: this.injector },
    );
  }

  private async push(behavior: { closeToTray: boolean; minimizeToTray: boolean }): Promise<void> {
    try {
      // A command with no `Result` on the Rust side: it throws if the bridge is absent.
      await commands.setWindowBehavior(behavior);
    } catch {
      // Outside Tauri (jsdom): a browser window files itself nowhere.
    }
  }
}
