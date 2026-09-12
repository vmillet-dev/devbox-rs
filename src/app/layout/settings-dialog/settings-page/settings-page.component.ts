import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  DENSITIES,
  Density,
  LOCALE_CHOICES,
  LocaleChoice,
  THEME_CHOICES,
  ThemeChoice,
} from '@core/settings/app-settings.model';
import { SettingsStore } from '@core/settings/settings.store';
import { DEFAULT_SHORTCUTS, acceleratorFromEvent } from '@core/shortcuts/shortcut.model';

/** A native control's `value`, without an `$any` in the template. */
function selectedValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function checkedValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

/**
 * Every control writes straight into [`SettingsStore`] — there is no draft to confirm, and
 * the `core/` services carry each change down to the native side.
 */
@Component({
  selector: 'app-settings-page',
  imports: [TranslocoPipe],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPageComponent {
  protected readonly settings = inject(SettingsStore);

  protected readonly locales = LOCALE_CHOICES;
  protected readonly themes = THEME_CHOICES;
  protected readonly densities = DENSITIES;
  protected readonly defaultShortcut = DEFAULT_SHORTCUTS.palette;

  protected onLocale(event: Event): void {
    this.settings.setLocale(selectedValue(event) as LocaleChoice);
  }

  protected onTheme(event: Event): void {
    this.settings.setTheme(selectedValue(event) as ThemeChoice);
  }

  protected onDensity(event: Event): void {
    this.settings.setDensity(selectedValue(event) as Density);
  }

  protected onStartWithSystem(event: Event): void {
    this.settings.setStartWithSystem(checkedValue(event));
  }

  protected onMinimizeToTray(event: Event): void {
    this.settings.setMinimizeToTray(checkedValue(event));
  }

  protected onCloseToTray(event: Event): void {
    this.settings.setCloseToTray(checkedValue(event));
  }

  protected onShowPinnedFirst(event: Event): void {
    this.settings.setShowPinnedFirst(checkedValue(event));
  }

  protected onCopyConfirmation(event: Event): void {
    this.settings.setCopyConfirmation(checkedValue(event));
  }

  /**
   * The field accepts no text: it **listens for a keystroke**. Typing `Ctrl+Alt+P` by hand
   * would let through combinations the native side cannot read back.
   *
   * A keystroke with no modifier is not a combination and goes back to the dialog: that is
   * what leaves Tab and Escape working inside the field.
   */
  protected onShortcutKeydown(event: KeyboardEvent): void {
    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) return;

    event.preventDefault();
    this.settings.setPaletteShortcut(accelerator);
  }

  protected resetShortcut(): void {
    this.settings.setPaletteShortcut(this.defaultShortcut);
  }
}
