import type { NotesQueryDto, NotesViewDto } from '../data/note-view.dto';
import type { NoteDraftDto, NoteDto, NotePatchDto } from '../data/note.dto';
import type { SpaceDraftDto, SpaceDto } from '../data/space.dto';

/**
 * Signature de chaque commande Tauri : nom, arguments, valeur de retour.
 *
 * # Pourquoi cette table existe
 *
 * Tauri apparie les arguments **par nom**, pas par position. Une clé mal
 * orthographiée compile sans broncher et n'échoue qu'à l'exécution, sous la
 * forme d'un rejet de désérialisation serde — donc un `IpcError` sans code, le
 * cas le plus opaque à diagnostiquer. Cette table transforme cette faute en
 * erreur de build.
 *
 * Les clés doivent donc correspondre **exactement** aux paramètres des
 * `#[tauri::command]` de `src-tauri/src/commands/`. ⚠️ Tauri v2 applique
 * `rename_all = "camelCase"` aux arguments : un paramètre Rust `note_id`
 * s'écrirait `noteId` ici. Aucun paramètre n'est composé aujourd'hui, mais la
 * règle mord au premier qui le sera.
 *
 * Les imports sont volontairement `import type` : ils s'effacent à la
 * compilation, donc ce module ne crée aucun cycle avec `core/data`.
 */
export interface IpcContract {
  readonly query_notes: { args: { query: NotesQueryDto }; result: NotesViewDto };
  readonly create_note: { args: { draft: NoteDraftDto }; result: NoteDto };
  readonly update_note: { args: { id: string; patch: NotePatchDto }; result: NoteDto };
  readonly delete_note: { args: { id: string }; result: void };
  /** Pas d'arguments : `db: State` est injecté par Tauri, pas fourni par le front. */
  readonly list_spaces: { args: undefined; result: readonly SpaceDto[] };
  readonly create_space: { args: { draft: SpaceDraftDto }; result: SpaceDto };
  readonly rename_space: { args: { id: string; draft: SpaceDraftDto }; result: SpaceDto };
  /**
   * ⚠️ Premier paramètre composé du contrat : le Rust déclare `target_space_id`,
   * Tauri v2 l'expose en `targetSpaceId`. L'écrire en snake_case ici compilerait
   * et échouerait à l'exécution sur un rejet serde sans code.
   */
  readonly delete_space: { args: { id: string; targetSpaceId: string }; result: void };
}

export type IpcCommand = keyof IpcContract;

export type IpcArgs<C extends IpcCommand> = IpcContract[C]['args'];
export type IpcResult<C extends IpcCommand> = IpcContract[C]['result'];

/**
 * Argument optionnel exactement pour les commandes qui n'en prennent pas, et
 * obligatoire pour les autres — au lieu d'un `args?` uniformément facultatif
 * qui laisserait passer un appel dépourvu de sa charge utile.
 */
export type IpcInvocation<C extends IpcCommand> = IpcArgs<C> extends undefined ? [] : [IpcArgs<C>];
