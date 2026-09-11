import { Injectable } from '@angular/core';
import { Contribution, ContributionRegistry } from '@core/contributions/contribution.registry';

/**
 * `keys` is already split — `['Ctrl', 'K']` and not `'Ctrl+K'` — because each one is
 * rendered as its own `<kbd>`. A step that is not a key press (`Ctrl` + click, a drag) is
 * spelled out in the label instead: a `<kbd>Click</kbd>` would read as a key to press.
 */
export interface ShortcutEntry {
  readonly keys: readonly string[];
  readonly labelKey: string;
}

/** A heading of the sheet, contributed whole by whoever owns those keys. */
export interface ShortcutGroup extends Contribution {
  readonly labelKey: string;
  readonly shortcuts: readonly ShortcutEntry[];
}

/**
 * The global shortcuts are **not** registered here: they are the application's, they work
 * with the window closed, and one of them follows a preference — the dialog reads them
 * from `SettingsStore` so the sheet shows what is really bound.
 */
@Injectable({ providedIn: 'root' })
export class ShortcutsRegistry extends ContributionRegistry<ShortcutGroup> {
  readonly groups = this.items;
}
