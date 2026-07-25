/**
 * Noms des commandes Rust exposées par `tauri::generate_handler![...]`
 * (`src-tauri/src/lib.rs`). Les garder en union de littéraux évite les fautes
 * de frappe, qui ne se manifesteraient sinon qu'à l'exécution par un
 * « command not found ».
 */
export type IpcCommand =
  'saluer' | 'query_notes' | 'create_note' | 'update_note' | 'delete_note' | 'list_spaces' | 'create_space';

/**
 * Causes d'échec que le backend sait nommer, en miroir de `ErrorCode`
 * (`src-tauri/src/commands/error.rs`). Ajouter une variante d'un côté impose
 * de l'ajouter de l'autre.
 *
 * Ce sont des **codes**, jamais du texte : c'est ce qui permet de réagir à une
 * cause précise et d'afficher un message traduit, là où une chaîne rédigée en
 * Rust imposerait sa langue à toute l'interface.
 */
export type IpcErrorCode =
  | 'noteNotFound'
  | 'spaceNotFound'
  | 'duplicateSpaceName'
  | 'schemaTooRecent'
  | 'storageUnavailable'
  | 'storage';

/** Forme sérialisée d'un `AppError` Rust. */
interface IpcErrorPayload {
  readonly code: IpcErrorCode;
  readonly params: Record<string, string>;
  readonly detail: string;
}

function isIpcErrorPayload(cause: unknown): cause is IpcErrorPayload {
  if (typeof cause !== 'object' || cause === null) return false;
  const candidate = cause as Partial<IpcErrorPayload>;
  return typeof candidate.code === 'string' && typeof candidate.detail === 'string';
}

function describeCause(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error) return cause.message;
  return JSON.stringify(cause);
}

/**
 * Échec d'un appel `invoke()`.
 *
 * `code` vaut `null` quand le rejet ne vient pas de nos commandes : Tauri
 * rejette lui-même avec une **chaîne** si la commande est inconnue ou si un
 * argument ne se désérialise pas. Ce cas doit rester lisible, d'où le repli sur
 * `describeCause`.
 */
export class IpcError extends Error {
  readonly code: IpcErrorCode | null;
  /** Valeurs à interpoler dans le message traduit, ex. `{ name }`. */
  readonly params: Record<string, string>;

  constructor(
    readonly command: IpcCommand,
    override readonly cause: unknown,
  ) {
    const structured = isIpcErrorPayload(cause) ? cause : null;
    super(`La commande Tauri « ${command} » a échoué : ${structured?.detail ?? describeCause(cause)}`);
    this.name = 'IpcError';
    this.code = structured?.code ?? null;
    this.params = structured?.params ?? {};
  }
}
