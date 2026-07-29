import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '../errors/error-notifier.service';
import { AvailableUpdate, DownloadProgress, UpdaterService } from './updater.service';

/**
 * `idle` — rien à proposer. `available` — la pop-in attend une décision.
 * `installing` — téléchargement puis installation en cours, la décision est
 * prise et n'est plus annulable. `installed` — l'application va redémarrer.
 */
export type UpdateStatus = 'idle' | 'available' | 'installing' | 'installed';

/**
 * Ce que la dernière vérification laisse à dire dans le menu, **distinct** de
 * `UpdateStatus` : les mélanger ferait dépendre l'état de la pop-in d'une
 * recherche sans suite. `idle` couvre les deux cas muets — avant toute
 * recherche, et après une recherche fructueuse, où c'est la pop-in qui parle.
 */
export type CheckState = 'idle' | 'checking' | 'upToDate' | 'failed';

/**
 * État de la mise à jour applicative.
 *
 * Rien ne s'installe sans geste explicite : une mise à jour silencieuse
 * redémarrerait l'application au milieu d'une frappe, or les brouillons de
 * l'éditeur ne sont confirmés qu'au blur.
 *
 * Un échec de **vérification** reste muet : hors ligne ou sur une build de dev
 * dont la clé publique est un gabarit, `check()` échoue à chaque lancement, et
 * un bandeau rouge serait un reproche quotidien sans rien à corriger. Un échec
 * d'**installation** fait suite à une action explicite et doit se voir.
 */
@Injectable({ providedIn: 'root' })
export class UpdateStore {
  private readonly updater = inject(UpdaterService);
  private readonly notifier = inject(ErrorNotifier);

  private readonly _update = signal<AvailableUpdate | null>(null);
  private readonly _status = signal<UpdateStatus>('idle');
  private readonly _progress = signal<DownloadProgress>(null);
  private readonly _checkState = signal<CheckState>('idle');

  readonly update: Signal<AvailableUpdate | null> = this._update.asReadonly();
  readonly status: Signal<UpdateStatus> = this._status.asReadonly();
  readonly checkState: Signal<CheckState> = this._checkState.asReadonly();

  /** Entier 0–100, ou `null` tant que l'avancement est indéterminé. */
  readonly progressPercent = computed<number | null>(() => {
    const progress = this._progress();
    return progress === null ? null : Math.round(progress * 100);
  });

  /** Vérification automatique du démarrage : muette dans tous les cas. */
  async check(): Promise<void> {
    await this.runCheck({ silent: true });
  }

  /**
   * Vérification demandée depuis le menu « À propos ».
   *
   * Contrairement à celle du démarrage, elle **parle** : l'utilisateur a cliqué
   * et attend une réponse, y compris « il n'y a rien ». Un échec passe donc aussi
   * par `ErrorNotifier`, dont le bandeau survit à la fermeture du menu — la ligne
   * d'état, elle, disparaît avec lui.
   */
  async checkNow(): Promise<void> {
    await this.runCheck({ silent: false });
  }

  private async runCheck({ silent }: { silent: boolean }): Promise<void> {
    // Une installation en cours ne se laisse pas doubler, et une proposition déjà
    // affichée n'a pas besoin d'être redemandée.
    if (this._status() !== 'idle') return;

    this._checkState.set('checking');
    try {
      const found = await this.updater.check();
      if (found) {
        this._update.set(found);
        this._status.set('available');
      }
      this._checkState.set(found ? 'idle' : 'upToDate');
    } catch (error) {
      this._checkState.set('failed');
      console.warn('Vérification des mises à jour impossible.', error);
      if (!silent) {
        this.notifier.notify({
          ref: { key: 'errors.updateCheckFailed' },
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Accepte la mise à jour proposée. Sur Windows, l'installateur arrête
   * l'application avant que `relaunch()` ne soit atteint ; l'appel reste
   * nécessaire pour les autres plateformes.
   */
  async accept(): Promise<void> {
    if (this._status() !== 'available') return;

    this._status.set('installing');
    this._progress.set(null);

    try {
      await this.updater.install((progress) => this._progress.set(progress));
      this._status.set('installed');
      await this.updater.relaunch();
    } catch (error) {
      console.error(error);
      this.notifier.notify({
        ref: { key: 'errors.updateFailed' },
        detail: error instanceof Error ? error.message : String(error),
      });
      // Retour à l'état proposé plutôt qu'à `idle` : l'utilisateur garde la
      // pop-in sous les yeux et peut réessayer sans relancer l'application.
      this._status.set('available');
    }
  }

  /** « Plus tard » : la proposition disparaît jusqu'au prochain lancement. */
  async dismiss(): Promise<void> {
    if (this._status() === 'installing') return;

    this._update.set(null);
    this._status.set('idle');
    await this.updater.discard();
  }
}
