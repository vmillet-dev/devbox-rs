import { InjectionToken, Injectable, inject } from '@angular/core';
import { exit } from '@tauri-apps/plugin-process';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * A token, as for the clipboard: under jsdom there is no bridge, and a spec really calling
 * `exit()` would take the test runner down.
 */
export interface AppWindowAdapter {
  hide(): Promise<void>;
  exit(code: number): Promise<void>;
}

export const APP_WINDOW_ADAPTER = new InjectionToken<AppWindowAdapter>('APP_WINDOW_ADAPTER', {
  providedIn: 'root',
  factory: () => ({
    hide: () => getCurrentWindow().hide(),
    exit: (code: number) => exit(code),
  }),
});

/**
 * The two are distinct and stay so: the window's close button **hides** (`lib.rs`
 * intercepts `CloseRequested` while there is a tray), and `quit` is the only path that
 * actually ends the process.
 */
@Injectable({ providedIn: 'root' })
export class AppWindowService {
  private readonly adapter = inject(APP_WINDOW_ADAPTER);

  /** After a copy from the palette: the user goes off to paste elsewhere. */
  async hide(): Promise<void> {
    try {
      await this.adapter.hide();
    } catch {
      // Outside Tauri, or the window is already hidden: nothing to recover.
    }
  }

  async quit(): Promise<void> {
    try {
      await this.adapter.exit(0);
    } catch {
      // Same: a failure here leaves nothing inconsistent behind.
    }
  }
}
