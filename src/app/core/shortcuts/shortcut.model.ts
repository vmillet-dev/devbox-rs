import type { ShortcutBindings } from '@core/ipc/bindings';

export type { ShortcutBindings };

/**
 * ⚠️ Miroir de `ShortcutBindings::defaults()` (`src-tauri/src/desktop.rs`).
 *
 * Le doublon est voulu : le natif prend ces combinaisons **avant** que le front
 * ait démarré, sans quoi `Ctrl+Alt+P` serait mort le temps du premier rendu —
 * précisément la seconde où l'on s'en sert depuis une autre application.
 *
 * Seule la palette est réglable depuis les préférences ; les deux autres
 * voyagent telles quelles, la commande native prenant les trois d'un bloc.
 */
export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  capture: 'Ctrl+Alt+V',
  newNote: 'Ctrl+Alt+N',
  palette: 'Ctrl+Alt+P',
};

/**
 * Codes d'une touche **modificatrice** : tant qu'ils sont seuls, la combinaison
 * n'est pas finie et il n'y a rien à enregistrer.
 */
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'AltGraph',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
]);

/**
 * Touches nommées que l'analyseur natif reconnaît. Les lettres, les chiffres et
 * les touches de fonction sont traités à part, par motif.
 */
const NAMED_KEYS = new Set([
  'Space',
  'Tab',
  'Enter',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'CapsLock',
  'PrintScreen',
  'ScrollLock',
  'Pause',
]);

const MODIFIER_NAMES = new Set(['Ctrl', 'Alt', 'Shift', 'Super']);

/**
 * Le nom que le natif attend pour cette touche, ou `null` si elle ne peut pas
 * porter un raccourci global.
 *
 * `KeyboardEvent.code` décrit la **position** de la touche, pas le caractère
 * qu'elle produit : un raccourci réglé sur un clavier AZERTY reste au même
 * endroit sur un QWERTY, ce que `event.key` ne garantirait pas.
 */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];

  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];

  return isKeyName(code) ? code : null;
}

/**
 * Ce qu'[`keyName`] produit, et donc ce qu'un accélérateur enregistré porte —
 * `P` et non `KeyP`, les deux étant acceptés par l'analyseur natif.
 */
function isKeyName(name: string): boolean {
  return (
    /^[A-Z]$/.test(name) || /^\d$/.test(name) || /^F([1-9]|1\d|2[0-4])$/.test(name) || NAMED_KEYS.has(name)
  );
}

/**
 * La combinaison que cette frappe décrit, ou `null` tant qu'il n'y en a pas.
 *
 * Un modificateur au moins est exigé : un raccourci **global** sans
 * modificateur avalerait la touche dans toutes les applications de la machine,
 * y compris pendant une saisie.
 */
export function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(event.code)) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Super');
  if (modifiers.length === 0) return null;

  const key = keyName(event.code);

  return key ? [...modifiers, key].join('+') : null;
}

/** Ce que le natif saurait relire : au moins un modificateur, puis une touche. */
export function isAccelerator(value: string): boolean {
  const tokens = value.split('+').map((token) => token.trim());
  if (tokens.length < 2) return false;

  const key = tokens[tokens.length - 1];
  const modifiers = tokens.slice(0, -1);

  return modifiers.every((modifier) => MODIFIER_NAMES.has(modifier)) && isKeyName(key);
}
