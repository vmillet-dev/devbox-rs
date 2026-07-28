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
 * État de la mise à jour applicative.
 *
 * Rien ne s'installe sans un geste explicite de l'utilisateur : `check()`
 * n'expose qu'une proposition, et seul `accept()` télécharge. Une mise à jour
 * silencieuse redémarrerait l'application au milieu d'une note en cours de
 * frappe — les brouillons de l'éditeur ne sont confirmés qu'au blur.
 *
 * Un échec de vérification reste **muet** : hors ligne, derrière un proxy ou sur
 * une build de développement dont la clé publique est un gabarit, `check()`
 * échoue à chaque lancement. Un bandeau rouge y répondrait par un reproche
 * quotidien alors que l'application fonctionne et que l'utilisateur n'a rien à
 * corriger. Un échec d'**installation**, lui, fait suite à une action explicite
 * et doit donc se voir.
 */
@Injectable({ providedIn: 'root' })
export class UpdateStore {
  private readonly updater = inject(UpdaterService);
  private readonly notifier = inject(ErrorNotifier);

  private readonly _update = signal<AvailableUpdate | null>(null);
  private readonly _status = signal<UpdateStatus>('idle');
  private readonly _progress = signal<DownloadProgress>(null);

  readonly update: Signal<AvailableUpdate | null> = this._update.asReadonly();
  readonly status: Signal<UpdateStatus> = this._status.asReadonly();

  /** Entier 0–100, ou `null` tant que l'avancement est indéterminé. */
  readonly progressPercent = computed<number | null>(() => {
    const progress = this._progress();
    return progress === null ? null : Math.round(progress * 100);
  });

  async check(): Promise<void> {
    if (this._status() !== 'idle') return;

    try {
      const found = await this.updater.check();
      if (found) {
        this._update.set(found);
        this._status.set('available');
      }
    } catch (error) {
      console.warn('Vérification des mises à jour impossible.', error);
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
