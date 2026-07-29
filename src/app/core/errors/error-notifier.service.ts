import { Injectable, Signal, signal } from '@angular/core';
import { TranslationRef } from '../i18n/translation-ref';
import { IpcError, IpcErrorCode } from '../ipc/ipc-error';

/** Message d'erreur destiné à l'utilisateur, exprimé en clé de traduction. */
export interface AppNotice {
  readonly ref: TranslationRef;
  /** Détail technique brut, affiché en second plan. */
  readonly detail?: string;
}

/** Message lisible d'une valeur levée, qui n'est pas toujours une `Error`. */
export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Message propre à chaque cause que le back sait nommer.
 *
 * `Record<IpcErrorCode, …>` et non `Partial` : ajouter une variante casse la
 * compilation ici tant que sa clé n'est pas décidée — c'est ce qui rend le
 * miroir Rust ↔ front vérifiable par le compilateur.
 *
 * `null` = rien de plus utile à dire que le message d'action de l'appelant. Une
 * panne SQLite générique est dans ce cas.
 */
const CODE_KEYS: Record<IpcErrorCode, string | null> = {
  noteNotFound: 'errors.noteGone',
  spaceNotFound: 'errors.spaceGone',
  duplicateSpaceName: 'errors.spaceNameTaken',
  invalidInput: 'errors.invalidInput',
  storageUnavailable: 'errors.storageUnavailable',
  storage: null,
};

/**
 * Traduit un échec en message affichable. `fallback` porte l'action tentée,
 * employée quand la cause n'apprend rien de plus — ou quand Tauri a rejeté
 * lui-même, auquel cas il n'y a pas de code. Les paramètres du back priment sur
 * ceux de l'appelant.
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
 * Canal de remontée des erreurs vers l'interface.
 *
 * Sur une app de bureau l'utilisateur n'ouvre pas la console : une écriture qui
 * échoue doit être visible à l'écran, sans quoi l'app paraît « ne rien faire ».
 * Une seule erreur est conservée, pour ne pas empiler les bannières.
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
   * Échec d'une action : `key` décrit ce qui était tenté, mais si le back a
   * nommé la cause elle prime — « cette note n'existe plus » est plus utile que
   * « impossible d'enregistrer ».
   */
  reportFailure(key: string, error: unknown, params?: Record<string, string>): void {
    console.error(error);
    this.notify(ipcNotice(error, { key }, params));
  }
}
