import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/services/errors/error-notifier.service';
import { VaultRepository } from '../data/vault.repository';
import { VaultState } from '@core/model/vault.model';

/**
 * ⚠️ The state lives in Rust, not here: a page reload must not ask again for a library
 * this process already has open. That is also what keeps `reopenSession` working in the
 * end-to-end suite, where the front end reboots and the process does not.
 */
@Injectable({ providedIn: 'root' })
export class VaultStore {
  private readonly repository = inject(VaultRepository);
  private readonly notifier = inject(ErrorNotifier);

  private readonly _state = signal<VaultState | null>(null);
  private readonly _isWorking = signal(false);
  private readonly _refused = signal(false);

  /** `null` until the first answer: the shell renders nothing rather than guessing. */
  readonly state = this._state.asReadonly();
  readonly isWorking = this._isWorking.asReadonly();

  /** The last attempt was refused. Cleared as soon as the field is touched again. */
  readonly refused = this._refused.asReadonly();

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

  /** Typing again is what withdraws the refusal — it should not outlive the correction. */
  clearRefusal(): void {
    this._refused.set(false);
  }

  /**
   * ⚠️ A refused passphrase is not reported through the banner: it is the ordinary answer
   * to a typo, and it belongs beside the field that caused it. Anything else is a failure
   * and goes where failures go.
   */
  private async attempt(action: () => Promise<void>): Promise<boolean> {
    this._isWorking.set(true);
    this._refused.set(false);
    try {
      await action();
      this._state.set('unlocked');
      return true;
    } catch (error) {
      if (isWrongPassphrase(error)) {
        this._refused.set(true);
        return false;
      }

      this.notifier.reportFailure('errors.unlockFailed', error);
      return false;
    } finally {
      this._isWorking.set(false);
    }
  }
}

function isWrongPassphrase(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'wrongPassphrase';
}
