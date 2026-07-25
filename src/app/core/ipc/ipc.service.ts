import { Injectable } from '@angular/core';
import { InvokeArgs, invoke } from '@tauri-apps/api/core';

/**
 * Noms des commandes Rust exposées par `tauri::generate_handler![...]`
 * (`src-tauri/src/lib.rs`). Les garder en union de littéraux évite les fautes
 * de frappe, qui ne se manifesteraient sinon qu'à l'exécution par un
 * « command not found ».
 */
export type IpcCommand =
  'saluer' | 'list_notes' | 'create_note' | 'update_note' | 'delete_note' | 'list_spaces' | 'create_space';

/**
 * Échec d'un appel `invoke()`. Tauri rejette avec la valeur du `Err` Rust
 * (souvent une simple `String`) : on la conserve dans `cause` tout en
 * produisant un message exploitable dans les logs et le `ErrorHandler`.
 */
export class IpcError extends Error {
  constructor(
    readonly command: IpcCommand,
    override readonly cause: unknown,
  ) {
    super(`La commande Tauri « ${command} » a échoué : ${describeCause(cause)}`);
    this.name = 'IpcError';
  }
}

function describeCause(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error) return cause.message;
  return JSON.stringify(cause);
}

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
