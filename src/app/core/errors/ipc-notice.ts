import { IpcError, IpcErrorCode } from '../ipc/ipc.service';
import { TranslationRef } from '../models/translation-ref.model';
import { AppNotice } from './error-notifier.service';

/**
 * Message propre à chaque cause que le back sait nommer.
 *
 * `Record<IpcErrorCode, …>` et non `Partial` : ajouter une variante à
 * `IpcErrorCode` casse la compilation ici tant que sa clé n'a pas été décidée.
 * C'est ce qui rend le miroir Rust ↔ front vérifiable par le compilateur plutôt
 * que par la relecture.
 *
 * `null` = rien de plus utile à dire que le message d'action de l'appelant
 * (« Impossible d'enregistrer la note »). Une panne SQLite générique est dans ce
 * cas : nommer la cause n'aiderait pas l'utilisateur à agir.
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
 * Traduit un échec d'écriture en message affichable.
 *
 * `fallback` porte l'action tentée, employée quand la cause n'apprend rien de
 * plus — ou quand Tauri a rejeté lui-même, auquel cas il n'y a pas de code.
 * `params` fournit les valeurs d'interpolation dont l'appelant dispose déjà,
 * celles du back prenant le dessus.
 */
export function ipcNotice(
  error: unknown,
  fallback: TranslationRef,
  params: Record<string, string> = {},
): AppNotice {
  const detail = error instanceof Error ? error.message : String(error);

  if (error instanceof IpcError && error.code !== null) {
    const key = CODE_KEYS[error.code];
    if (key) {
      return { ref: { key, params: { ...params, ...error.params } }, detail };
    }
  }

  return { ref: fallback, detail };
}
