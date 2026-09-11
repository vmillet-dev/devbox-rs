import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsStore } from '@core/settings/settings.store';
import { DEFAULT_SHORTCUTS, acceleratorKeys } from '@core/shortcuts/shortcut.model';
import { ShortcutGroup, ShortcutsRegistry } from '@core/shortcuts/shortcuts.registry';
import { DialogComponent } from '@shared/ui/dialog/dialog.component';

/**
 * The keyboard sheet: what to press, and what it does.
 *
 * The **global** group is built here rather than registered, because it is the
 * application's own: those three combinations are taken by the native side
 * before the front has started, and the quick-paste one follows a preference —
 * reading `SettingsStore` is what makes the sheet show the key that is really
 * bound rather than the one that shipped.
 *
 * Everything else comes from [`ShortcutsRegistry`], where the features
 * contribute their groups. The sheet is read-only on purpose: the one shortcut
 * that can be changed is changed where it is set, in the preferences, and a
 * second editor for it would be a second place to keep in step.
 */
@Component({
  selector: 'app-shortcuts-dialog',
  imports: [DialogComponent, TranslocoPipe],
  templateUrl: './shortcuts-dialog.component.html',
  styleUrl: './shortcuts-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortcutsDialogComponent {
  private readonly registry = inject(ShortcutsRegistry);
  private readonly settings = inject(SettingsStore);

  readonly closed = output<void>();

  protected readonly groups = computed<readonly ShortcutGroup[]>(() => [
    {
      id: 'global',
      labelKey: 'shortcuts.groups.global',
      // Ahead of every registered group: these keys work with the window
      // closed, which is what makes them worth reading first.
      order: 0,
      shortcuts: [
        {
          keys: acceleratorKeys(this.settings.paletteShortcut()),
          labelKey: 'shortcuts.global.palette',
        },
        { keys: acceleratorKeys(DEFAULT_SHORTCUTS.capture), labelKey: 'shortcuts.global.capture' },
        { keys: acceleratorKeys(DEFAULT_SHORTCUTS.newNote), labelKey: 'shortcuts.global.newNote' },
      ],
    },
    ...this.registry.groups(),
  ]);
}
