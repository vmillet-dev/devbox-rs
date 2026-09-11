import type { ShortcutBindings } from '@core/ipc/bindings';

export type { ShortcutBindings };

/**
 * ⚠️ Miroir de `ShortcutBindings::defaults()` (`src-tauri/src/desktop.rs`).
 *
 * The duplication is deliberate: the native side takes these **before** the
 * front has started, and without them `Ctrl+Alt+P` would be dead for the length
 * of the first render — precisely the second it is used from another
 * application.
 *
 * Only the palette is settable from the preferences; the other two travel as
 * they are, the native command taking all three at once.
 */
export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  capture: 'Ctrl+Alt+V',
  newNote: 'Ctrl+Alt+N',
  palette: 'Ctrl+Alt+P',
};

/**
 * The codes of a **modifier** key: while they are alone the combination is not
 * finished and there is nothing to record.
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
 * Named keys the native parser recognises. Letters, digits and function keys
 * are handled separately, by pattern.
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
 * The name the native side expects for this key, or `null` when it cannot carry
 * a global shortcut.
 *
 * ⚠️ `KeyboardEvent.code` describes the key's **position**, not the character it
 * produces: a shortcut set on an AZERTY keyboard stays in the same place on a
 * QWERTY, which `event.key` would not guarantee.
 */
function keyName(code: string): string | null {
  const named = /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit(\d)$/.exec(code)?.[1];

  return named ?? (isKeyName(code) ? code : null);
}

/**
 * What [`keyName`] produces, and so what a stored accelerator carries — `P` and
 * not `KeyP`, both being accepted by the native parser.
 */
function isKeyName(name: string): boolean {
  return (
    /^[A-Z]$/.test(name) || /^\d$/.test(name) || /^F([1-9]|1\d|2[0-4])$/.test(name) || NAMED_KEYS.has(name)
  );
}

/**
 * The combination this keystroke describes, or `null` while there is none.
 *
 * ⚠️ At least one modifier is required: a **global** shortcut without one would
 * swallow that key in every application on the machine, typing included.
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

/** What the native side could read back: at least one modifier, then a key. */
export function isAccelerator(value: string): boolean {
  const tokens = value.split('+').map((token) => token.trim());
  if (tokens.length < 2) return false;

  const key = tokens.at(-1);
  const modifiers = tokens.slice(0, -1);

  return key !== undefined && modifiers.every((modifier) => MODIFIER_NAMES.has(modifier)) && isKeyName(key);
}

/**
 * The keys of an accelerator, one per `<kbd>`: `'Ctrl+Alt+P'` → `['Ctrl', 'Alt', 'P']`.
 *
 * Rendering the accelerator as a single string would put the `+` separators
 * inside the key caps, where they read as a key to press.
 */
export function acceleratorKeys(accelerator: string): readonly string[] {
  return accelerator
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token !== '');
}
