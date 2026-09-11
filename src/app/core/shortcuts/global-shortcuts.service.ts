import { Injectable, Injector, effect, inject } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { SettingsStore } from '@core/settings/settings.store';
import { DEFAULT_SHORTCUTS, ShortcutBindings } from './shortcut.model';

/**
 * Les raccourcis actifs hors de la fenêtre, et ce qu'il faut dire quand une
 * autre application en garde un.
 *
 * Le natif ne peut qu'échouer en silence — le premier arrivé garde la
 * combinaison — et une ligne de journal n'est pas une interface : sans ce
 * message, presser `Ctrl+Alt+P` ne fait rien et rien ne dit pourquoi.
 *
 * Les trois voyagent ensemble parce que la commande native les reprend d'un
 * bloc ; seule la palette est réglable, les deux autres restent à leur valeur
 * d'origine.
 */
@Injectable({ providedIn: 'root' })
export class GlobalShortcutsService {
  private readonly notifier = inject(ErrorNotifier);
  private readonly settings = inject(SettingsStore);
  private readonly injector = inject(Injector);

  /**
   * Pousse les raccourcis maintenant, puis à chaque fois que la préférence
   * change. Appelée depuis `provideAppInitializer`, donc hors constructeur :
   * l'injecteur est passé explicitement plutôt que déduit de l'appelant.
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
      // Commande sans `Result` côté Rust : elle lève directement si le pont est
      // absent, comme `sync_tray`.
      const taken = await commands.setGlobalShortcuts(bindings);
      if (taken.length > 0) {
        this.notifier.notify({
          ref: { key: 'shortcuts.unavailable', params: { list: taken.join(', ') } },
        });
      }
    } catch {
      // Hors Tauri (jsdom) : il n'y a pas de raccourci global à prendre.
    }
  }
}
