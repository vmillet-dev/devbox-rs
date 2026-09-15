import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import { VaultState } from '../model/vault.model';

/**
 * ⚠️ The passphrase crosses the bridge and is never held on this side: nothing here keeps
 * it, and the field that carried it is cleared as soon as it has been sent.
 */
@Injectable({ providedIn: 'root' })
export class VaultRepository {
  async state(): Promise<VaultState> {
    return unwrap('vault_state', await commands.vaultState());
  }

  async create(passphrase: string): Promise<void> {
    unwrap('create_vault', await commands.createVault(passphrase));
  }

  async unlock(passphrase: string): Promise<void> {
    unwrap('unlock_vault', await commands.unlockVault(passphrase));
  }
}
