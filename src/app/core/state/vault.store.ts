import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/services/errors/error-notifier.service';
import { PreferencesService } from '@core/services/preferences/preferences.service';
import { StatusNotifier } from '@core/services/notifications/status.service';
import { hasErrorCode } from '@core/ipc/ipc.error';
import { VaultRepository } from '../data/vault.repository';
import { VaultState } from '@core/model/vault.model';
import { SEEDED_KEY } from './sample-notes.service';

/**
 * ⚠️ The state lives in Rust, not here: a page reload must not ask again for a library
 * this process already has open. That is also what keeps `reopenSession` working in the
 * end-to-end suite, where the front end reboots and the process does not.
 */
@Injectable({ providedIn: 'root' })
export class VaultStore {
  private readonly repository = inject(VaultRepository);
  private readonly notifier = inject(ErrorNotifier);
  private readonly status = inject(StatusNotifier);
  private readonly preferences = inject(PreferencesService);

  private readonly _state = signal<VaultState | null>(null);
  private readonly _isWorking = signal(false);
  private readonly _refused = signal(false);
  private readonly _damaged = signal(false);

  /** `null` until the first answer: the shell renders nothing rather than guessing. */
  readonly state = this._state.asReadonly();
  readonly isWorking = this._isWorking.asReadonly();

  /** The last attempt was refused. Cleared as soon as the field is touched again. */
  readonly refused = this._refused.asReadonly();

  /**
   * SQLite says the file is damaged. ⚠️ Not a refusal and not a failure: retyping the
   * passphrase will not help, so the screen has to offer something else entirely.
   */
  readonly damaged = this._damaged.asReadonly();

  readonly isUnlocked = computed(() => this._state() === 'unlocked');
  readonly needsCreating = computed(() => this._state() === 'absent');

  async load(): Promise<void> {
    try {
      this._state.set(await this.repository.state());
    } catch (error) {
      this.notifier.reportFailure('errors.vaultStateFailed', error);
    }
  }

  /** The first launch of a library that has never been encrypted. */
  async create(passphrase: string): Promise<boolean> {
    return this.attempt(() => this.repository.create(passphrase));
  }

  async unlock(passphrase: string): Promise<boolean> {
    return this.attempt(() => this.repository.unlock(passphrase));
  }

  /**
   * A new phrase over the same library. ⚠️ Nothing is re-encrypted — the phrase only ever
   * wrapped the key the notes are sealed with — so this cannot leave a library half
   * readable, and the session carries on as it was.
   */
  async changePassphrase(current: string, next: string): Promise<boolean> {
    return this.attempt(
      () => this.repository.changePassphrase(current, next),
      'errors.passphraseChangeFailed',
    );
  }

  /** Typing again is what withdraws the refusal — it should not outlive the correction. */
  clearRefusal(): void {
    this._refused.set(false);
  }

  /**
   * Moves the damaged library aside so the next unlock starts on a fresh one, and says
   * where it went.
   *
   * ⚠️ The samples marker goes with it. Without that, the fresh library opens on a canvas
   * with no space — and a note cannot be created without one, so the application would
   * come back working and unusable.
   */
  async setAsideDamagedLibrary(): Promise<boolean> {
    this._isWorking.set(true);
    try {
      const target = await this.repository.setAsideDamagedLibrary();
      this.preferences.forget(SEEDED_KEY);
      this._damaged.set(false);
      this.status.notify({ key: 'vault.setAside', params: { path: target } });

      return true;
    } catch (error) {
      this.notifier.reportFailure('errors.setAsideFailed', error);
      return false;
    } finally {
      this._isWorking.set(false);
    }
  }

  /**
   * ⚠️ A refused passphrase is not reported through the banner: it is the ordinary answer
   * to a typo, and it belongs beside the field that caused it. Anything else is a failure
   * and goes where failures go.
   */
  private async attempt(action: () => Promise<void>, failureKey = 'errors.unlockFailed'): Promise<boolean> {
    this._isWorking.set(true);
    this._refused.set(false);
    try {
      await action();
      this._state.set('unlocked');
      return true;
    } catch (error) {
      if (hasErrorCode(error, 'wrongPassphrase')) {
        this._refused.set(true);
        return false;
      }

      if (hasErrorCode(error, 'libraryDamaged')) {
        this._damaged.set(true);
        return false;
      }

      this.notifier.reportFailure(failureKey, error);
      return false;
    } finally {
      this._isWorking.set(false);
    }
  }
}
