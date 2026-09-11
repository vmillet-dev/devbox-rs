import { Injectable, Signal, signal } from '@angular/core';
import { TranslationRef } from '../i18n/translation-ref.model';
import { IpcError, IpcErrorCode } from '../ipc/ipc.error';

/** A user-facing error message, expressed as a translation key. */
export interface AppNotice {
  readonly ref: TranslationRef;
  /** Raw technical detail, shown in the background. */
  readonly detail?: string;
}

/** A readable message for a thrown value, which is not always an `Error`. */
export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A message per cause the back end can name.
 *
 * `Record<IpcErrorCode, …>` and not `Partial`: adding a variant breaks the build
 * here until its key is decided, which is what makes the Rust ↔ front mirror
 * checkable by the compiler.
 *
 * `null` means there is nothing more useful to say than the caller's own action
 * message — a generic SQLite failure is one such case.
 */
const CODE_KEYS: Record<IpcErrorCode, string | null> = {
  noteNotFound: 'errors.noteGone',
  spaceNotFound: 'errors.spaceGone',
  duplicateSpaceName: 'errors.spaceNameTaken',
  attachmentNotFound: 'errors.attachmentGone',
  fileAccess: 'errors.fileAccess',
  importFormat: 'errors.importFormat',
  invalidInput: 'errors.invalidInput',
  storageUnavailable: 'errors.storageUnavailable',
  storage: null,
};

/**
 * Turns a failure into a displayable message. `fallback` carries the action
 * attempted, used when the cause adds nothing — or when Tauri rejected on its
 * own, in which case there is no code. The back end's params win.
 */
export function ipcNotice(
  error: unknown,
  fallback: TranslationRef,
  params: Record<string, string> = {},
): AppNotice {
  const detail = errorDetail(error);

  if (error instanceof IpcError && error.code !== null) {
    const key = CODE_KEYS[error.code];
    if (key) {
      return { ref: { key, params: { ...params, ...error.params } }, detail };
    }
  }

  return { ref: fallback, detail };
}

/**
 * The channel that carries errors up to the interface.
 *
 * On a desktop app the user does not open the console: a write that fails has
 * to be visible on screen, or the app appears to "do nothing". One error is
 * kept at a time, so banners do not stack.
 */
@Injectable({ providedIn: 'root' })
export class ErrorNotifier {
  private readonly _notice = signal<AppNotice | null>(null);

  readonly notice: Signal<AppNotice | null> = this._notice.asReadonly();

  notify(notice: AppNotice): void {
    this._notice.set(notice);
  }

  dismiss(): void {
    this._notice.set(null);
  }

  /**
   * A failed action: `key` says what was attempted, but a cause the back end
   * named wins — "this note no longer exists" is more useful than "could not
   * save".
   */
  reportFailure(key: string, error: unknown, params?: Record<string, string>): void {
    console.error(error);
    this.notify(ipcNotice(error, { key }, params));
  }

  /**
   * Runs `action`, reporting a failure as `key` and answering `null`.
   *
   * The whole point is that the caller decides what `null` means — `false`, an
   * early return, a banner — instead of repeating the same `try`/`catch` in
   * every store. A thunk rather than a promise, so a synchronous throw is
   * caught too.
   */
  attempt<T>(key: string, action: () => Promise<T>, params?: Record<string, string>): Promise<T | null> {
    // `.catch` rather than `async`/`await`: wrapping in an async function adds
    // two microtask hops between the call and its answer, which is enough to
    // change when a rendered view settles.
    return action().catch((error: unknown) => {
      this.reportFailure(key, error, params);
      return null;
    });
  }
}
