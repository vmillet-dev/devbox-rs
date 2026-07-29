import { Injectable, Signal, computed, resource } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * ⚠️ Doit rester couverte par la portée déclarée pour `opener:allow-open-url`
 * dans `src-tauri/capabilities/default.json`, sinon l'ouverture est refusée à
 * l'exécution.
 */
export const REPOSITORY_URL = 'https://github.com/vmillet-dev/devbox-rs';

export const AUTHOR_NAME = 'Valentin MILLET';
export const AUTHOR_HANDLE = '@vmillet-dev';

/** Nom affiché dans la barre de titre. */
export const APP_NAME = 'DevBox';

/**
 * Seam vers les API Tauri décrivant l'application. Même raison d'être que
 * `UpdaterService` : ce sont des commandes du cœur et d'un plugin, absentes
 * d'`IpcContract`, et un composant qui les importerait deviendrait intestable —
 * jsdom n'a pas de pont Tauri.
 *
 * Pas de description ici : c'est du texte visible, donc une clé de traduction.
 */
@Injectable({ providedIn: 'root' })
export class AppInfoService {
  private readonly versionResource = resource({ loader: () => getVersion() });

  /**
   * Version de `tauri.conf.json`, que le job CI `check-version` maintient
   * alignée sur le tag. `null` hors runtime Tauri (`ng serve` seul) : la fiche
   * affiche alors un tiret plutôt que de mentir.
   */
  readonly version: Signal<string | null> = computed(() =>
    this.versionResource.hasValue() ? this.versionResource.value() : null,
  );

  /** Ouvre le dépôt dans le navigateur système, hors de la WebView. */
  async openRepository(): Promise<void> {
    await openUrl(REPOSITORY_URL);
  }
}
