import { Injectable, inject } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { ErrorNotifier } from '@core/errors/error-notifier.service';

/**
 * Raccourcis globaux qu'une autre application avait déjà pris.
 *
 * Le natif ne peut qu'échouer en silence — le premier arrivé garde la
 * combinaison — et une ligne de journal n'est pas une interface : sans ce
 * message, presser `Ctrl+Alt+P` ne fait rien et rien ne dit pourquoi.
 *
 * Lu **une fois** au démarrage : l'enregistrement a lieu dans le `setup()` de
 * Tauri, bien avant que la fenêtre existe, et le résultat ne change plus.
 */
@Injectable({ providedIn: 'root' })
export class GlobalShortcutsService {
  private readonly notifier = inject(ErrorNotifier);

  async report(): Promise<void> {
    try {
      // Commande sans `Result` côté Rust : elle lève directement si le pont est
      // absent, comme `sync_tray`.
      const taken = await commands.unavailableShortcuts();
      if (taken.length > 0) {
        this.notifier.notify({
          ref: { key: 'shortcuts.unavailable', params: { list: taken.join(', ') } },
        });
      }
    } catch {
      // Hors Tauri (jsdom) : il n'y a pas de raccourci global à annoncer.
    }
  }
}
