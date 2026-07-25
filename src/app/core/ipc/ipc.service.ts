import { Injectable } from '@angular/core';
import { InvokeArgs, invoke } from '@tauri-apps/api/core';
import { IpcCommand, IpcError } from './ipc-error';

export { IpcError } from './ipc-error';
export type { IpcCommand, IpcErrorCode } from './ipc-error';

/**
 * Unique point de passage vers le backend Rust. Aucun composant ni store
 * n'appelle `invoke()` directement : ça centralise le typage des commandes et
 * la normalisation des erreurs, et ça rend les dépôts testables en se
 * contentant de doubler ce service.
 */
@Injectable({ providedIn: 'root' })
export class IpcService {
  async invoke<T>(command: IpcCommand, args?: InvokeArgs): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (cause) {
      throw new IpcError(command, cause);
    }
  }
}
