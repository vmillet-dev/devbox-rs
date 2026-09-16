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

  /** Where a set-aside library was moved, and how many times it was asked for. */
  setAside: string[] = [];
  changes: { current: string; next: string }[] = [];

  /** ⚠️ Through the guard like the rest: reading the state is a command too, and it is
   *  the one that fails when there is no bridge at all. */
  async state(): Promise<VaultState> {
    const failure = this.failNext;
    this.failNext = null;
    if (failure !== null) throw failure;

    return this.answer;
  }

  async create(passphrase: string): Promise<void> {
    return this.attempt(passphrase);
  }

  async unlock(passphrase: string): Promise<void> {
    return this.attempt(passphrase);
  }

  /** Records the pair; `failNext` is how a spec makes the current phrase wrong. */
  async setAsideDamagedLibrary(): Promise<string> {
    const failure = this.failNext;
    this.failNext = null;
    if (failure !== null) throw failure;

    const target = `/data/damaged/${this.setAside.length + 1}`;
    this.setAside.push(target);
    this.answer = 'locked';

    return target;
  }

  async changePassphrase(current: string, next: string): Promise<void> {
    this.changes.push({ current, next });
    const failure = this.failNext;
    this.failNext = null;
    if (failure !== null) throw failure;
  }

  private async attempt(passphrase: string): Promise<void> {
    this.passphrases.push(passphrase);
    const failure = this.failNext;
    this.failNext = null;
    if (failure !== null) throw failure;

    this.answer = 'unlocked';
  }
}
