import { Injectable, computed, signal } from '@angular/core';

/**
 * One line of the shortcuts sheet: what to press, and what it does.
 *
 * `keys` is a list of **keys as they are pressed**, already split — `['Ctrl', 'K']`
 * and not `'Ctrl+K'` — because each one is rendered as its own `<kbd>`. A step
 * that is not a key press (`Ctrl` + click, a drag) is spelled out in the label
 * instead: inventing a `<kbd>Clic</kbd>` would read as a key to find on the
 * keyboard.
 */
export interface ShortcutEntry {
  readonly keys: readonly string[];
  readonly labelKey: string;
}

/** A heading of the sheet, contributed whole by whoever owns those keys. */
export interface ShortcutGroup {
  readonly id: string;
  readonly labelKey: string;
  /** Decides the order on the sheet; leave room between two groups. */
  readonly order: number;
  readonly shortcuts: readonly ShortcutEntry[];
}

/**
 * What the shortcuts sheet lists **beyond the application's own keys**.
 *
 * Same reason to exist as [`AppMenuRegistry`] and [`SettingsRegistry`]: arrows
 * on the canvas, `X` to tick an item and `Alt+↑` to reorder one belong to the
 * notes, and listing them from `layout/` would break the rule that deleting a
 * feature's folder deletes the feature — leaving a sheet full of keys that do
 * nothing the day the hashing tool is alone on screen.
 *
 * The global shortcuts are **not** registered here: they are the application's,
 * they work with the window closed, and one of them follows a preference — the
 * dialog reads them from `SettingsStore` so the sheet shows what is really bound.
 */
@Injectable({ providedIn: 'root' })
export class ShortcutsRegistry {
  private readonly _groups = signal<readonly ShortcutGroup[]>([]);

  readonly groups = computed<readonly ShortcutGroup[]>(() =>
    [...this._groups()].sort((left, right) => left.order - right.order),
  );

  /** Re-registering an id replaces the group rather than doubling it. */
  register(groups: readonly ShortcutGroup[]): void {
    const ids = new Set(groups.map((group) => group.id));
    this._groups.update((current) => [...current.filter((group) => !ids.has(group.id)), ...groups]);
  }

  unregister(ids: readonly string[]): void {
    const dropped = new Set(ids);
    this._groups.update((current) => current.filter((group) => !dropped.has(group.id)));
  }
}
