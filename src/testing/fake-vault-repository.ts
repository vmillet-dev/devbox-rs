import { VaultRepository } from '@core/data/vault.repository';
import { IpcError } from '@core/ipc/ipc.error';
import { VaultState } from '@core/model/vault.model';

/** The real one reaches for the Tauri bridge, absent under jsdom. */
export class FakeVaultRepository implements Pick<VaultRepository, keyof VaultRepository> {
  /** What `state()` answers. Specs set it before asking the store to load. */
  answer: VaultState = 'unlocked';

  /** When set, the next call rejects with it — a wrong passphrase, or worse. */
  failNext: IpcError | null = null;

  passphrases: string[] = [];

  async state(): Promise<VaultState> {
    return this.answer;
  }

  async create(passphrase: string): Promise<void> {
    return this.attempt(passphrase);
  }

  async unlock(passphrase: string): Promise<void> {
    return this.attempt(passphrase);
  }

  private async attempt(passphrase: string): Promise<void> {
    this.passphrases.push(passphrase);
    const failure = this.failNext;
    this.failNext = null;
    if (failure !== null) throw failure;

    this.answer = 'unlocked';
  }
}
