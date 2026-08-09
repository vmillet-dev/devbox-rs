import type { AppError, ErrorCode } from './bindings';

/**
 * Causes d'échec que le backend sait nommer. Simple alias de l'union **générée**
 * depuis `ErrorCode` (`src-tauri/src/error.rs`) : ce n'est plus un
 * miroir tenu à la main, une variante ajoutée en Rust apparaît ici dès la
 * régénération et casse la compilation partout où elle n'est pas traitée.
 *
 * Ce sont des **codes**, jamais du texte : c'est ce qui permet de réagir à une
 * cause précise et d'afficher un message traduit, là où une chaîne rédigée en
 * Rust imposerait sa langue à toute l'interface.
 */
export type IpcErrorCode = ErrorCode;

/**
 * Forme d'un `Result` Rust vue du TypeScript, telle que `bindings.ts` la rend.
 * Redéclarée plutôt qu'importée : le générateur l'écrit en ligne dans chaque
 * signature, sans jamais la nommer.
 */
export type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: AppError };

/**
 * Exhaustif par construction : ajouter une variante à `ErrorCode` en Rust rend
 * cet objet incomplet, donc la compilation échoue ici. Nécessaire malgré le
 * typage parce que `bindings.ts` **annonce** un `AppError` là où Tauri peut
 * avoir rejeté avec autre chose (voir [`IpcError`]).
 */
const IPC_ERROR_CODES: Record<IpcErrorCode, true> = {
  noteNotFound: true,
  spaceNotFound: true,
  duplicateSpaceName: true,
  invalidInput: true,
  storageUnavailable: true,
  storage: true,
};

function isAppError(cause: unknown): cause is AppError {
  if (typeof cause !== 'object' || cause === null) return false;
  const candidate = cause as Partial<AppError>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code in IPC_ERROR_CODES &&
    typeof candidate.detail === 'string'
  );
}

function describeCause(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error) return cause.message;
  return JSON.stringify(cause);
}

/**
 * Échec d'une commande.
 *
 * `code` vaut `null` quand le rejet ne vient pas de nos commandes : Tauri
 * rejette lui-même avec une **chaîne** si la commande est inconnue ou si un
 * argument ne se désérialise pas, et `bindings.ts` la range dans la branche
 * `error` en la typant `AppError` qu'elle n'est pas. Ce cas doit rester lisible,
 * d'où le repli sur `describeCause`.
 */
export class IpcError extends Error {
  readonly code: IpcErrorCode | null;
  /** Valeurs à interpoler dans le message traduit, ex. `{ name }`. */
  readonly params: Record<string, string>;

  constructor(
    readonly command: string,
    override readonly cause: unknown,
  ) {
    const structured = isAppError(cause) ? cause : null;
    super(`La commande Tauri « ${command} » a échoué : ${structured?.detail ?? describeCause(cause)}`);
    this.name = 'IpcError';
    this.code = structured?.code ?? null;
    this.params = structured?.params ?? {};
  }
}

/**
 * Convertit le `Result` discriminé des bindings en valeur ou en exception.
 *
 * Les dépôts lèvent plutôt que de propager le `status` : les stores et les
 * composants réagissent déjà à un `catch`, et faire remonter le discriminant
 * jusqu'aux appelants leur ferait porter une branche que `ErrorNotifier` traite
 * en un seul endroit.
 */
export function unwrap<T>(command: string, result: IpcResult<T>): T {
  if (result.status === 'error') {
    throw new IpcError(command, result.error);
  }
  return result.data;
}
