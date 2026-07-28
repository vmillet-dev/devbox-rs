import { Injectable } from '@angular/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { Update, check } from '@tauri-apps/plugin-updater';

/** Mise à jour proposée, réduite à ce que l'interface a besoin d'afficher. */
export interface AvailableUpdate {
  readonly version: string;
  readonly currentVersion: string;
  /** Notes de version telles que publiées dans le manifeste. */
  readonly notes?: string;
}

/** Avancement entre 0 et 1, ou `null` quand la taille totale est inconnue. */
export type DownloadProgress = number | null;

/**
 * Seul point de passage vers le plugin de mise à jour.
 *
 * `IpcService` couvre les commandes que nous écrivons ; celles-ci appartiennent
 * au plugin, ne figurent donc pas dans `IpcContract` et ne peuvent pas passer
 * par lui. Le principe reste le même : ni composant ni store n'importe
 * `@tauri-apps/plugin-updater`, ce qui rend le store testable en doublant cette
 * classe — sans quoi il faudrait un pont Tauri dans jsdom.
 *
 * L'objet `Update` rendu par le plugin est une **ressource native** : il porte
 * un identifiant côté Rust et doit être refermé s'il n'est pas installé. Il est
 * retenu ici plutôt que remonté au store, qui n'aurait rien à en faire sinon le
 * faire fuir.
 */
@Injectable({ providedIn: 'root' })
export class UpdaterService {
  private pending: Update | null = null;

  /** `null` quand l'application est déjà à jour. */
  async check(): Promise<AvailableUpdate | null> {
    await this.discard();

    const update = await check();
    if (!update) return null;

    this.pending = update;
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body,
    };
  }

  /**
   * Télécharge puis installe la mise à jour retenue par le dernier `check()`.
   * Sur Windows, l'installateur arrête l'application lui-même : ce qui suit cet
   * appel n'est pas garanti de s'exécuter.
   */
  async install(onProgress: (progress: DownloadProgress) => void): Promise<void> {
    const update = this.pending;
    if (!update) throw new Error('Aucune mise à jour en attente.');

    let total: number | null = null;
    let downloaded = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          // `contentLength` est absent si le serveur ne l'annonce pas : la barre
          // reste alors indéterminée plutôt que d'afficher un faux pourcentage.
          total = event.data.contentLength ?? null;
          onProgress(null);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress(total !== null && total > 0 ? downloaded / total : null);
          break;
        case 'Finished':
          onProgress(1);
          break;
      }
    });

    this.pending = null;
  }

  async relaunch(): Promise<void> {
    await relaunch();
  }

  /** Referme la ressource native sans installer. */
  async discard(): Promise<void> {
    const update = this.pending;
    this.pending = null;
    await update?.close();
  }
}
