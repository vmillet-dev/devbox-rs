import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { commands, type TrayLabels as WireTrayLabels } from '@core/ipc/bindings';

export type TrayLabels = WireTrayLabels;

/**
 * Keyed by field: `satisfies` makes a label added to `TrayLabels` in Rust a compile
 * error here.
 */
const LABEL_KEYS = {
  open: 'tray.open',
  newNote: 'tray.newNote',
  capture: 'tray.capture',
  palette: 'tray.palette',
  quit: 'tray.quit',
} as const satisfies Record<keyof TrayLabels, string>;

/**
 * This service **creates** the tray rather than the native startup: the native side
 * writes no user-facing text, so without translated labels there would be nothing to
 * show. The subscription re-emits on every language change, which re-translates the menu.
 *
 * The actions do not go through here — the menu emits the same `GlobalAction` as the
 * global shortcuts.
 */
@Injectable({ providedIn: 'root' })
export class TrayService {
  private readonly transloco = inject(TranslocoService);

  start(): void {
    this.transloco
      .selectTranslate<string[]>(Object.values(LABEL_KEYS))
      .subscribe(([open = '', newNote = '', capture = '', palette = '', quit = '']) => {
        void this.push({ open, newNote, capture, palette, quit });
      });
  }

  /**
   * A failure does not surface: outside Tauri the bridge is absent, and on a desktop
   * without a tray the native side already declines silently.
   */
  private async push(labels: TrayLabels): Promise<void> {
    try {
      // The one command with no `Result` on the Rust side, hence no `unwrap`.
      await commands.syncTray(labels);
    } catch {
      // Without a tray, the application lives in its window.
    }
  }
}
