import { InjectionToken, Injectable, Injector, effect, inject } from '@angular/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { SettingsStore } from '@core/settings/settings.store';

/**
 * Tout ce que ce service attend du greffon. Un jeton plutôt qu'un appel direct,
 * pour la même raison pratique que `PREFERENCES_STORE_LOADER` : le builder
 * Angular regroupe les modules avant que Vitest ne les voie, et `vi.mock` sur un
 * paquet externe n'intercepte alors qu'une fois sur deux.
 */
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
 * « Démarrer avec le système » : une entrée que l'OS tient pour nous — la clé
 * `Run` du registre sur Windows, un agent de lancement sur macOS.
 *
 * L'état réel appartient donc au système, pas au fichier de préférences : au
 * démarrage c'est lui qu'on lit, et la préférence s'aligne dessus. Sans cette
 * relecture, désactiver le démarrage automatique depuis le gestionnaire des
 * tâches laisserait la case cochée — et DevBox le réactiverait au premier
 * réglage suivant.
 */
@Injectable({ providedIn: 'root' })
export class AutostartService {
  private readonly adapter = inject(AUTOSTART_ADAPTER);
  private readonly settings = inject(SettingsStore);
  private readonly injector = inject(Injector);

  /**
   * Aligne la préférence sur ce que le système déclare, puis suit chaque
   * changement. Ne rejette jamais : un démarrage automatique impossible à régler
   * ne doit pas empêcher l'application de s'ouvrir.
   */
  async start(): Promise<void> {
    try {
      this.settings.setStartWithSystem(await this.adapter.isEnabled());
    } catch {
      // Hors Tauri, ou greffon indisponible : la préférence garde sa valeur.
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
      // Relu d'abord : `enable()` réécrirait l'entrée du système à chaque
      // démarrage, et sur macOS un agent réenregistré perd son état.
      if ((await this.adapter.isEnabled()) === enabled) return;

      await (enabled ? this.adapter.enable() : this.adapter.disable());
    } catch {
      // Idem : l'échec est silencieux, la case reste ce que l'utilisateur a mis.
    }
  }
}
