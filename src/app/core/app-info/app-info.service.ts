import { Injectable, Signal, computed, resource } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { REPOSITORY_URL } from './app-info';

/**
 * Seam vers les API Tauri qui décrivent l'application elle-même.
 *
 * Même raison d'être que `UpdaterService` : ce sont des commandes du cœur et
 * d'un plugin, absentes d'`IpcContract`, et un composant qui les importerait
 * directement deviendrait intestable — jsdom n'a pas de pont Tauri.
 */
@Injectable({ providedIn: 'root' })
export class AppInfoService {
  private readonly versionResource = resource({ loader: () => getVersion() });

  /**
   * Version déclarée par `tauri.conf.json`, source de vérité que le job CI
   * `check-version` maintient alignée sur le tag. `null` hors runtime Tauri
   * (`ng serve` seul) : la fiche affiche alors un tiret plutôt que de mentir.
   */
  readonly version: Signal<string | null> = computed(() =>
    this.versionResource.hasValue() ? this.versionResource.value() : null,
  );

  /** Ouvre le dépôt dans le navigateur système, hors de la WebView. */
  async openRepository(): Promise<void> {
    await openUrl(REPOSITORY_URL);
  }
}
