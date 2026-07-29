import { Injectable } from '@angular/core';
import { InvokeArgs, invoke } from '@tauri-apps/api/core';
import type {
  NoteDraftDto,
  NoteDto,
  NotePatchDto,
  NotesQueryDto,
  NotesViewDto,
} from '@features/notes/data/note.dto';
import type { Space, SpaceDraft } from '@features/notes/model/space.model';
import { IpcError } from './ipc.error';

/**
 * Signature de chaque commande Tauri : nom, arguments, valeur de retour.
 *
 * Tauri apparie les arguments **par nom**. Une clé mal orthographiée compilerait
 * sans broncher et n'échouerait qu'à l'exécution, sur un rejet serde — donc un
 * `IpcError` sans code, le cas le plus opaque à diagnostiquer. Cette table en
 * fait une erreur de build.
 *
 * ⚠️ Tauri v2 applique `rename_all = "camelCase"` aux arguments : un paramètre
 * Rust `target_space_id` s'écrit `targetSpaceId` ici. Les imports sont
 * `import type` pour ne créer aucun cycle avec `features/notes/data`.
 *
 * Un espace circule sous son type du modèle : sa forme sur le fil est celle du
 * domaine, donc il n'a pas de DTO — contrairement à une note, dont les dates et
 * les unions demandent une conversion (`note.dto.ts`).
 */
export interface IpcContract {
  readonly query_notes: { args: { query: NotesQueryDto }; result: NotesViewDto };
  readonly create_note: { args: { draft: NoteDraftDto }; result: NoteDto };
  readonly update_note: { args: { id: string; patch: NotePatchDto }; result: NoteDto };
  readonly delete_note: { args: { id: string }; result: void };
  /** `db: State` est injecté par Tauri, pas fourni par le front. */
  readonly list_spaces: { args: undefined; result: readonly Space[] };
  readonly create_space: { args: { draft: SpaceDraft }; result: Space };
  readonly rename_space: { args: { id: string; draft: SpaceDraft }; result: Space };
  readonly delete_space: { args: { id: string; targetSpaceId: string }; result: void };
}

export type IpcCommand = keyof IpcContract;
export type IpcResult<C extends IpcCommand> = IpcContract[C]['result'];

/**
 * Argument optionnel exactement pour les commandes qui n'en prennent pas, au
 * lieu d'un `args?` uniformément facultatif qui laisserait passer un appel
 * dépourvu de sa charge utile.
 */
export type IpcInvocation<C extends IpcCommand> = IpcContract[C]['args'] extends undefined
  ? []
  : [IpcContract[C]['args']];

/**
 * Unique point de passage vers le backend Rust : aucun composant ni store
 * n'appelle `invoke()` directement. Centralise la normalisation des erreurs et
 * rend les dépôts testables en doublant ce seul service.
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
