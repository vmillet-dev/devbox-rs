import { Injectable, Injector, effect, inject } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { SettingsStore } from '@core/settings/settings.store';

/**
 * Ce que la croix et le bouton « réduire » de la fenêtre doivent faire.
 *
 * Poussé vers le natif comme les libellés de la barre système : la préférence
 * vit dans `preferences.json`, côté front, et la relire depuis Rust ferait une
 * seconde source à tenir en phase. Le natif porte quand même un défaut — la
 * fenêtre peut être fermée avant que le front ait démarré.
 *
 * ⚠️ Les deux réglages ne valent que s'il y a une barre système : sans elle, le
 * natif refuse de cacher la fenêtre, faute de quoi il resterait un processus que
 * plus rien ne peut rappeler.
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
      // Commande sans `Result` côté Rust : elle lève si le pont est absent.
      await commands.setWindowBehavior(behavior);
    } catch {
      // Hors Tauri (jsdom) : la fenêtre du navigateur ne se range nulle part.
    }
  }
}
