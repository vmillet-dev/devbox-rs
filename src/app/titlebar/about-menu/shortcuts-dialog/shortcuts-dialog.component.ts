import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsStore } from '@core/services/settings/settings.store';
import { DEFAULT_SHORTCUTS, ShortcutGroup, acceleratorKeys } from '@core/services/shortcuts/shortcut.model';
import { NOTES_SHORTCUT_GROUPS } from '@notes/notes-shortcuts';
import { DialogComponent } from '@shared/dialog/dialog.component';

/**
 * The **global** group is built here rather than registered, because it is the
 * application's own: those three combinations are taken by the native side before the
 * front has started, and the quick-paste one follows a preference — reading
 * `SettingsStore` is what makes the sheet show the key that is really bound.
 *
 * The sheet is read-only on purpose: the one shortcut that can be changed is changed in
 * the preferences.
 */
@Component({
  selector: 'app-shortcuts-dialog',
  imports: [DialogComponent, TranslocoPipe],
  templateUrl: './shortcuts-dialog.component.html',
  styleUrl: './shortcuts-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortcutsDialogComponent {
  private readonly settings = inject(SettingsStore);

  readonly closed = output<void>();

  protected readonly groups = computed<readonly ShortcutGroup[]>(() => [
    {
      id: 'global',
      labelKey: 'shortcuts.groups.global',
      // First: these keys work with the window closed.
      shortcuts: [
        {
          keys: acceleratorKeys(this.settings.paletteShortcut()),
          labelKey: 'shortcuts.global.palette',
        },
        { keys: acceleratorKeys(DEFAULT_SHORTCUTS.capture), labelKey: 'shortcuts.global.capture' },
        { keys: acceleratorKeys(DEFAULT_SHORTCUTS.newNote), labelKey: 'shortcuts.global.newNote' },
      ],
    },
    ...NOTES_SHORTCUT_GROUPS,
  ]);
}
