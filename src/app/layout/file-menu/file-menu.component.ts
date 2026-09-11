import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppMenuEntry, AppMenuRegistry } from '@core/menu/app-menu.registry';
import { AppWindowService } from '@core/window/app-window.service';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';
import { SettingsDialogComponent } from '@layout/settings-dialog/settings-dialog.component';

/**
 * Menu « Fichier » de la barre de titre, à côté d'« À propos » — la convention
 * d'une application de bureau.
 *
 * Il n'exécute rien lui-même sauf quitter : les entrées viennent
 * d'[`AppMenuRegistry`], où les features les inscrivent. La barre de titre reste
 * ainsi ignorante des notes, et l'outil de hachage à venir posera ses propres
 * entrées sans toucher à ce fichier.
 */
@Component({
  selector: 'app-file-menu',
  imports: [TranslocoPipe, MenuPanelDirective, SettingsDialogComponent],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './file-menu.component.html',
  styleUrl: './file-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileMenuComponent {
  private readonly window = inject(AppWindowService);

  protected readonly registry = inject(AppMenuRegistry);
  protected readonly menu = inject(MenuTriggerDirective);

  /** Quitter ferme l'application pour de bon : un second clic le confirme. */
  protected readonly confirmingQuit = signal(false);

  protected readonly settingsOpen = signal(false);

  constructor() {
    this.menu.escaped.subscribe(() => this.menu.close());
    this.menu.closed.subscribe(() => this.confirmingQuit.set(false));
  }

  /**
   * Le menu se referme sur l'action : le compte rendu s'affiche sous la barre de
   * titre (`StatusToastComponent`), pas dans le panneau — un sélecteur de
   * fichiers natif passe devant, et rouvrir le menu pour lire le résultat serait
   * absurde.
   */
  protected run(entry: AppMenuEntry): void {
    if (entry.disabled?.()) return;

    entry.run();
    this.menu.close(false);
  }

  /**
   * Les préférences ne passent pas par le registre : elles règlent
   * l'application elle-même, pas une feature — le menu les offre donc toujours,
   * au même titre que « Quitter ».
   */
  protected openSettings(): void {
    this.settingsOpen.set(true);
    // Sans focus rendu : la modale qui s'ouvre le prend elle-même.
    this.menu.close(false);
  }

  /**
   * Le piège à focus de la modale rendrait la main à l'élément actif au moment
   * de son ouverture — l'entrée de menu, détruite depuis. Le focus repart donc
   * sur le déclencheur, seul point de repère encore à l'écran.
   */
  protected closeSettings(): void {
    this.settingsOpen.set(false);
    this.menu.focusAnchor();
  }

  protected onQuit(): void {
    if (!this.confirmingQuit()) {
      this.confirmingQuit.set(true);
      return;
    }
    void this.window.quit();
  }
}
