import type { AppError, ErrorCode } from './bindings';

/**
 * Failure causes the back end can name. A plain alias of the union **generated**
 * from `ErrorCode`, so a variant added in Rust appears here on regeneration and
 * breaks the build everywhere it is not handled.
 *
 * These are **codes**, never text: that is what allows reacting to a precise
 * cause and showing a translated message, where a sentence written in Rust
 * would impose its language on the whole interface.
 */
export type IpcErrorCode = ErrorCode;

/**
 * A Rust `Result` seen from TypeScript. Redeclared rather than imported: the
 * generator writes it inline in every signature without ever naming it.
 */
export type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: AppError };

/**
 * Exhaustive by construction: adding a variant to `ErrorCode` in Rust makes
 * this object incomplete and fails the build here.
 *
 * ⚠️ Needed despite the typing, because `bindings.ts` **declares** an `AppError`
 * where Tauri may have rejected with something else (see [`IpcError`]).
 */
const IPC_ERROR_CODES: Record<IpcErrorCode, true> = {
  noteNotFound: true,
  spaceNotFound: true,
  duplicateSpaceName: true,
  attachmentNotFound: true,
  fileAccess: true,
  importFormat: true,
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
 * A command failure.
 *
 * ⚠️ `code` is `null` when the rejection does not come from our commands: Tauri
 * rejects with a plain **string** for an unknown command or an argument that
 * fails to deserialise, and `bindings.ts` files that in the `error` branch
 * typed as an `AppError` it is not. Hence the fallback to `describeCause`.
 */
export class IpcError extends Error {
  readonly code: IpcErrorCode | null;
  /** Values to interpolate into the translated message, e.g. `{ name }`. */
  readonly params: Record<string, string>;

  constructor(
    readonly command: string,
    override readonly cause: unknown,
  ) {
    const structured = isAppError(cause) ? cause : null;
    super(`Tauri command "${command}" failed: ${structured?.detail ?? describeCause(cause)}`);
    this.name = 'IpcError';
    this.code = structured?.code ?? null;
    this.params = structured?.params ?? {};
  }
}

/**
 * Turns the bindings' discriminated `Result` into a value or an exception.
 *
 * The repositories throw rather than propagate the `status`: stores and
 * components already react to a `catch`, and carrying the discriminant up to
 * them would make every caller hold a branch `ErrorNotifier` handles once.
 */
export function unwrap<T>(command: string, result: IpcResult<T>): T {
  if (result.status === 'error') {
    throw new IpcError(command, result.error);
  }
  return result.data;
}
