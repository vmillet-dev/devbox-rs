import { IpcCommand } from './ipc-contract';

/**
 * Causes d'échec que le backend sait nommer, en miroir de `ErrorCode`
 * (`src-tauri/src/commands/error.rs`). Ajouter une variante d'un côté impose de
 * l'ajouter de l'autre — **et** de la déclarer dans `IPC_ERROR_CODES`, sinon
 * elle arrivera en `null`.
 *
 * Ce sont des **codes**, jamais du texte : c'est ce qui permet de réagir à une
 * cause précise et d'afficher un message traduit, là où une chaîne rédigée en
 * Rust imposerait sa langue à toute l'interface.
 *
 * `schemaTooRecent` n'y figure volontairement pas : il n'est produit que par la
 * migration, pendant le `setup()` de Tauri, où l'échec avorte le lancement. Il
 * ne peut pas traverser le pont, et le déclarer ici laisserait croire le contraire.
 */
export type IpcErrorCode =
  'noteNotFound' | 'spaceNotFound' | 'duplicateSpaceName' | 'invalidInput' | 'storageUnavailable' | 'storage';

const IPC_ERROR_CODES: readonly IpcErrorCode[] = [
  'noteNotFound',
  'spaceNotFound',
  'duplicateSpaceName',
  'invalidInput',
  'storageUnavailable',
  'storage',
];

function isIpcErrorCode(value: string): value is IpcErrorCode {
  return (IPC_ERROR_CODES as readonly string[]).includes(value);
}

/** Forme sérialisée d'un `AppError` Rust. */
interface IpcErrorPayload {
  readonly code: IpcErrorCode;
  readonly params: Record<string, string>;
  readonly detail: string;
}

function isIpcErrorPayload(cause: unknown): cause is IpcErrorPayload {
  if (typeof cause !== 'object' || cause === null) return false;
  const candidate = cause as Partial<IpcErrorPayload>;
  // `code` est confronté à la liste, pas seulement à son type : un back plus
  // récent enverrait sinon une variante inconnue que `IpcErrorCode` prétendrait
  // couvrir, et les appelants qui discriminent dessus tomberaient dans un cas
  // qu'ils croient impossible.
  return (
    typeof candidate.code === 'string' &&
    isIpcErrorCode(candidate.code) &&
    typeof candidate.detail === 'string'
  );
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
