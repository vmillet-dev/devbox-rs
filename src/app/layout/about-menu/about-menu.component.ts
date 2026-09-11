import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/i18n/translation-ref.model';
import { UpdateStore } from '@core/updates/update.store';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';
import { AboutDialogComponent } from '@layout/about-dialog/about-dialog.component';
import { GettingStartedDialogComponent } from '@layout/getting-started-dialog/getting-started-dialog.component';
import { ShortcutsDialogComponent } from '@layout/shortcuts-dialog/shortcuts-dialog.component';
import { WhatsNewDialogComponent } from '@layout/whats-new-dialog/whats-new-dialog.component';

/**
 * What the menu can put on screen. One signal rather than one flag per panel:
 * they share a backdrop rung and only ever appear one at a time, and four
 * booleans would allow a state where two of them are stacked.
 */
export type AboutPanel = 'whatsNew' | 'gettingStarted' | 'shortcuts' | 'about';

/**
 * The titlebar's "À propos" menu: check for an update, the three help panels,
 * and the card itself.
 *
 * The update check reports **in place** — that is the whole point of a manual
 * check next to the silent one at startup.
 */
@Component({
  selector: 'app-about-menu',
  imports: [
    TranslocoPipe,
    AboutDialogComponent,
    GettingStartedDialogComponent,
    ShortcutsDialogComponent,
    WhatsNewDialogComponent,
    MenuPanelDirective,
  ],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './about-menu.component.html',
  styleUrl: './about-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutMenuComponent {
  protected readonly store = inject(UpdateStore);
  protected readonly menu = inject(MenuTriggerDirective);

  protected readonly panel = signal<AboutPanel | null>(null);

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

  protected openPanel(panel: AboutPanel): void {
    this.panel.set(panel);
    // Sans focus rendu : la modale qui s'ouvre le prend elle-même.
    this.menu.close(false);
  }

  /**
   * Le piège à focus de la modale rendrait la main à l'élément actif au moment
   * de son ouverture — l'entrée de menu, détruite depuis. Le focus repart donc
   * sur le déclencheur, seul point de repère encore à l'écran.
   */
  protected closePanel(): void {
    this.panel.set(null);
    this.menu.focusAnchor();
  }
}
