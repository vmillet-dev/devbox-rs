import { Injectable, Injector, effect, inject } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { SettingsStore } from '@core/settings/settings.store';
import { DEFAULT_SHORTCUTS, ShortcutBindings } from './shortcut.model';

/**
 * ⚠️ The native side can only fail silently — first come, first served — and a log line is
 * not an interface: without this message, pressing the key does nothing and nothing says
 * why.
 *
 * All three travel together because the native command takes them as a block; only the
 * palette is settable.
 */
@Injectable({ providedIn: 'root' })
export class GlobalShortcutsService {
  private readonly notifier = inject(ErrorNotifier);
  private readonly settings = inject(SettingsStore);
  private readonly injector = inject(Injector);

  /**
   * Pushes the shortcuts now, then on every preference change.
   *
   * ⚠️ Called from `provideAppInitializer`, so outside a constructor: the injector is
   * passed explicitly rather than inferred from the caller.
   */
  start(): void {
    effect(
      () => {
        void this.apply({ ...DEFAULT_SHORTCUTS, palette: this.settings.paletteShortcut() });
      },
      { injector: this.injector },
    );
  }

  private async apply(bindings: ShortcutBindings): Promise<void> {
    try {
      // A command with no `Result` on the Rust side: it throws when the bridge is absent.
      const taken = await commands.setGlobalShortcuts(bindings);
      if (taken.length > 0) {
        this.notifier.notify({
          ref: { key: 'shortcuts.unavailable', params: { list: taken.join(', ') } },
        });
      }
    } catch {
      // Outside Tauri (jsdom): there is no global shortcut to take.
    }
  }
}
