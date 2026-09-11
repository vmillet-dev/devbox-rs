import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '../errors/error-notifier.service';
import { AvailableUpdate, DownloadProgress, UpdaterService } from './updater.service';

/**
 * `idle` — nothing to offer. `available` — the prompt awaits a decision.
 * `installing` — downloading then installing, no longer cancellable.
 * `installed` — the application is about to restart.
 */
export type UpdateStatus = 'idle' | 'available' | 'installing' | 'installed';

/**
 * What the last check leaves to say in the menu, **distinct** from
 * `UpdateStatus`: merging them would make the prompt's state depend on a check
 * that led nowhere. `idle` covers both silent cases — before any check, and
 * after a fruitful one, where the prompt does the talking.
 */
export type CheckState = 'idle' | 'checking' | 'upToDate' | 'failed';

/**
 * Application update state.
 *
 * Nothing installs without an explicit gesture: a silent update would restart
 * the application mid-keystroke, and the editor's drafts only commit on blur.
 *
 * ⚠️ A failed **check** stays silent: offline, or on a dev build whose public
 * key is a placeholder, `check()` fails on every launch, and a red banner would
 * be a daily reproach with nothing to fix. A failed **install** follows an
 * explicit action and has to be seen.
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

  /** An integer 0–100, or `null` while progress is indeterminate. */
  readonly progressPercent = computed<number | null>(() => {
    const progress = this._progress();
    return progress === null ? null : Math.round(progress * 100);
  });

  /** The automatic startup check: silent in every case. */
  async check(): Promise<void> {
    await this.runCheck({ silent: true });
  }

  /**
   * A check asked for from the "About" menu.
   *
   * Unlike the startup one it **speaks**: the user clicked and expects an
   * answer, "there is nothing" included. A failure therefore also goes through
   * `ErrorNotifier`, whose banner outlives the menu closing.
   */
  async checkNow(): Promise<void> {
    await this.runCheck({ silent: false });
  }

  private async runCheck({ silent }: { silent: boolean }): Promise<void> {
    // An install in progress will not be overtaken, and an offer already on
    // screen does not need asking for again.
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
      console.warn('Could not check for updates.', error);
      if (!silent) {
        this.notifier.notify({
          ref: { key: 'errors.updateCheckFailed' },
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Accepts the offered update. On Windows the installer stops the application
   * before `relaunch()` is reached; the call is still needed elsewhere.
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
      // Back to the offered state rather than `idle`: the user keeps the prompt
      // in view and can retry without relaunching.
      this._status.set('available');
    }
  }

  /** "Later": the offer disappears until the next launch. */
  async dismiss(): Promise<void> {
    if (this._status() === 'installing') return;

    this._update.set(null);
    this._status.set('idle');
    await this.updater.discard();
  }
}
