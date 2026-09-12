import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/services/i18n/translation-ref.model';
import { UpdateStore } from '@core/services/updates/update.store';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';
import { AboutDialogComponent } from '@titlebar/about-menu/about-dialog/about-dialog.component';
import { GettingStartedDialogComponent } from '@titlebar/about-menu/getting-started-dialog/getting-started-dialog.component';
import { ShortcutsDialogComponent } from '@titlebar/about-menu/shortcuts-dialog/shortcuts-dialog.component';
import { WhatsNewDialogComponent } from '@titlebar/about-menu/whats-new-dialog/whats-new-dialog.component';

/**
 * One signal rather than one flag per panel: they share a backdrop rung and only ever
 * appear one at a time, where four booleans would allow a state with two stacked.
 */
export type AboutPanel = 'whatsNew' | 'gettingStarted' | 'shortcuts' | 'about';

/**
 * The update check reports **in place** — that is the whole point of a manual check next
 * to the silent one at startup.
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

  /**
   * `null` when the menu has nothing to announce. Exhaustive rather than defaulted: a
   * state added to `CheckState` must break the build here.
   */
  protected readonly checkStatusRef = computed<TranslationRef | null>(() => {
    switch (this.store.checkState()) {
      case 'checking':
        return { key: 'about.checking' };
      case 'upToDate':
        return { key: 'about.upToDate' };
      case 'failed':
        return { key: 'about.checkFailed' };
      case 'idle':
        return null;
    }
  });

  protected checkUpdates(): void {
    if (this.checking()) return;
    void this.store.checkNow();
  }

  protected openPanel(panel: AboutPanel): void {
    this.panel.set(panel);
    // No focus restored: the modal opening takes it itself.
    this.menu.close(false);
  }

  /**
   * The modal's focus trap would hand back to the menu entry, destroyed since: focus
   * returns to the trigger, the only landmark still on screen.
   */
  protected closePanel(): void {
    this.panel.set(null);
    this.menu.focusAnchor();
  }
}
