import { Injectable } from '@angular/core';
import { InvokeArgs, invoke } from '@tauri-apps/api/core';
import { IpcCommand, IpcInvocation, IpcResult } from './ipc-contract';
import { IpcError } from './ipc-error';

export { IpcError } from './ipc-error';
export type { IpcErrorCode } from './ipc-error';
export type { IpcCommand } from './ipc-contract';

/**
 * Unique point de passage vers le backend Rust. Aucun composant ni store
 * n'appelle `invoke()` directement : ça centralise la normalisation des erreurs
 * et ça rend les dépôts testables en se contentant de doubler ce service.
 *
 * Le nom de commande, la forme de ses arguments et son type de retour viennent
 * tous de `IpcContract` : une clé d'argument mal orthographiée ne compile plus,
 * alors qu'elle ne se voyait auparavant qu'à l'exécution.
 */
@Injectable({ providedIn: 'root' })
export class IpcService {
  async invoke<C extends IpcCommand>(command: C, ...args: IpcInvocation<C>): Promise<IpcResult<C>> {
    try {
      return await invoke<IpcResult<C>>(command, args[0] as InvokeArgs | undefined);
    } catch (cause) {
      throw new IpcError(command, cause);
    }
  }
}
