import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/i18n/translation-ref.model';
import { UpdateStore } from '@core/updates/update.store';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';
import { AboutDialogComponent } from '@layout/about-dialog/about-dialog.component';

/**
 * Menu « À propos » de la barre de titre. Deux entrées : chercher une mise à
 * jour, et ouvrir la fiche. La première rend compte sur place — c'est tout
 * l'intérêt d'une recherche manuelle face à celle du démarrage, silencieuse.
 */
@Component({
  selector: 'app-about-menu',
  imports: [TranslocoPipe, AboutDialogComponent, MenuPanelDirective],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './about-menu.component.html',
  styleUrl: './about-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutMenuComponent {
  protected readonly store = inject(UpdateStore);
  protected readonly menu = inject(MenuTriggerDirective);

  protected readonly dialogOpen = signal(false);

  constructor() {
    this.menu.escaped.subscribe(() => this.menu.close());
  }

  protected readonly checking = computed(() => this.store.checkState() === 'checking');

  /** `null` quand le menu n'a rien à annoncer — voir `CheckState`. */
  protected readonly checkStatusRef = computed<TranslationRef | null>(() => {
    switch (this.store.checkState()) {
      case 'checking':
        return { key: 'about.checking' };
      case 'upToDate':
        return { key: 'about.upToDate' };
      case 'failed':
        return { key: 'about.checkFailed' };
      default:
        return null;
    }
  });

  protected checkUpdates(): void {
    if (this.checking()) return;
    void this.store.checkNow();
  }

  protected openDialog(): void {
    this.dialogOpen.set(true);
    // Sans focus rendu : la modale qui s'ouvre le prend elle-même.
    this.menu.close(false);
  }

  /**
   * Le piège à focus de la modale rendrait la main à l'élément actif au moment
   * de son ouverture — l'entrée de menu, détruite depuis. Le focus repart donc
   * sur le déclencheur, seul point de repère encore à l'écran.
   */
  protected closeDialog(): void {
    this.dialogOpen.set(false);
    this.menu.focusAnchor();
  }
}
