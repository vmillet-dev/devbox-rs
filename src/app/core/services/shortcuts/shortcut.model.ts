import type { ShortcutBindings } from '@core/ipc/bindings';

export type { ShortcutBindings };

/** `keys` is split because each one is rendered as its own `<kbd>`. */
export interface ShortcutEntry {
  readonly keys: readonly string[];
  readonly labelKey: string;
}

export interface ShortcutGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly shortcuts: readonly ShortcutEntry[];
}

/**
 * ⚠️ Mirror of `ShortcutBindings::defaults()` (`src-tauri/src/desktop.rs`), and
 * deliberately so: the native side takes these before the front has started, and
 * without them `Ctrl+Alt+P` is dead for the length of the first render.
 */
export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  capture: 'Ctrl+Alt+V',
  newNote: 'Ctrl+Alt+N',
  palette: 'Ctrl+Alt+P',
};

/** A modifier alone is not a finished combination. */
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

/** Letters, digits and function keys are handled separately, by pattern. */
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
 * ⚠️ `KeyboardEvent.code` is the key's position, not the character it produces: a
 * shortcut set on AZERTY stays in the same place on QWERTY, which `event.key` would
 * not guarantee.
 */
function keyName(code: string): string | null {
  const named = /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit(\d)$/.exec(code)?.[1];

  return named ?? (isKeyName(code) ? code : null);
}

/** `P` and not `KeyP`, both being accepted by the native parser. */
function isKeyName(name: string): boolean {
  return (
    /^[A-Z]$/.test(name) || /^\d$/.test(name) || /^F([1-9]|1\d|2[0-4])$/.test(name) || NAMED_KEYS.has(name)
  );
}

/**
 * ⚠️ At least one modifier is required: a global shortcut without one would swallow
 * that key in every application on the machine, typing included.
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

export function isAccelerator(value: string): boolean {
  const tokens = value.split('+').map((token) => token.trim());
  if (tokens.length < 2) return false;

  const key = tokens.at(-1);
  const modifiers = tokens.slice(0, -1);

  return key !== undefined && modifiers.every((modifier) => MODIFIER_NAMES.has(modifier)) && isKeyName(key);
}

/** One key per `<kbd>`: a single string would put the `+` inside the key caps. */
export function acceleratorKeys(accelerator: string): readonly string[] {
  return accelerator
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token !== '');
}
