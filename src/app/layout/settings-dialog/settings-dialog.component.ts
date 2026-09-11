import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsPage, SettingsRegistry } from '@core/settings/settings-registry';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { SettingsPageComponent } from './settings-page/settings-page.component';

/**
 * Les réglages de l'application elle-même, toujours présents : ils ne dépendent
 * d'aucun outil chargé, contrairement aux pages du registre.
 */
const GENERAL_PAGE: SettingsPage = {
  id: 'general',
  labelKey: 'settings.pages.general',
  order: 10,
  component: SettingsPageComponent,
};

/**
 * Panneau de préférences : un rail de pages à gauche, la page choisie à droite.
 *
 * Il ne connaît qu'une seule page, la sienne. Les autres viennent de
 * [`SettingsRegistry`], où les features les inscrivent — « Variables » édite
 * les valeurs de `{{champs}}`, un sujet qui appartient aux notes, et l'importer
 * ici casserait la règle qui veut que supprimer un dossier de feature supprime
 * la feature.
 *
 * **Pas d'« OK / Annuler / Appliquer ».** Tout s'applique à la frappe : c'est
 * déjà l'idiome de l'application, et un thème qu'on ne voit qu'après validation
 * ne se choisit pas, il se devine.
 */
@Component({
  selector: 'app-settings-dialog',
  imports: [DialogBackdropDirective, FocusTrapDirective, NgComponentOutlet, TranslocoPipe],
  templateUrl: './settings-dialog.component.html',
  styleUrl: './settings-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class SettingsDialogComponent {
  private readonly registry = inject(SettingsRegistry);

  readonly closed = output<void>();

  protected readonly pages = computed<readonly SettingsPage[]>(() =>
    [GENERAL_PAGE, ...this.registry.pages()].sort((left, right) => left.order - right.order),
  );

  private readonly requestedPageId = signal<string | null>(null);

  /**
   * La page affichée. Retombe sur la première quand rien n'a été choisi — ou
   * quand la feature qui portait la page choisie vient d'être déchargée.
   */
  protected readonly activePage = computed<SettingsPage>(() => {
    const pages = this.pages();
    const requested = pages.find((page) => page.id === this.requestedPageId());

    return requested ?? pages[0];
  });

  protected select(id: string): void {
    this.requestedPageId.set(id);
  }
}
