import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DENSITIES, Density, THEME_CHOICES, ThemeChoice } from '@core/settings/app-settings.model';
import { SettingsStore } from '@core/settings/settings.store';
import { DEFAULT_SHORTCUTS, acceleratorFromEvent } from '@core/shortcuts/shortcut.model';

/** Le `value` d'un contrôle natif, sans `$any` dans le template. */
function selectedValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function checkedValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

/**
 * Les réglages de l'application : apparence, comportement de la fenêtre,
 * collage rapide, accusés de réception.
 *
 * Chaque contrôle écrit directement dans [`SettingsStore`] — il n'y a pas de
 * brouillon à valider, et ce sont les services de `core/` qui portent ensuite
 * chaque changement jusqu'au natif.
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

  protected readonly themes = THEME_CHOICES;
  protected readonly densities = DENSITIES;
  protected readonly defaultShortcut = DEFAULT_SHORTCUTS.palette;

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
   * Le champ n'accepte pas de texte : il **écoute une frappe**. Taper
   * `Ctrl+Alt+P` à la main laisserait passer des combinaisons que le natif ne
   * sait pas relire, et il n'y aurait rien pour le dire.
   *
   * Une frappe sans modificateur n'est pas une combinaison et repart au
   * dialogue : c'est ce qui laisse Tab et Échap fonctionner dans le champ.
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
