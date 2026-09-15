import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/services/i18n/translation-ref.model';
import { UpdateStore } from '@core/services/updates/update.store';
import { MenuPanelDirective } from '@shared/directives/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/directives/menu-trigger.directive';
import { AboutDialogComponent } from '@titlebar/about-menu/about-dialog/about-dialog.component';
import { GettingStartedDialogComponent } from '@titlebar/about-menu/getting-started-dialog/getting-started-dialog.component';
import { ShortcutsDialogComponent } from '@titlebar/about-menu/shortcuts-dialog/shortcuts-dialog.component';
import { WhatsNewDialogComponent } from '@titlebar/about-menu/whats-new-dialog/whats-new-dialog.component';

/** One signal rather than four booleans, which would allow a state with two stacked. */
export type AboutPanel = 'whatsNew' | 'gettingStarted' | 'shortcuts' | 'about';

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

  /** Exhaustive rather than defaulted: a state added to `CheckState` breaks the build. */
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

  /** The modal's focus trap would hand back to the menu entry, destroyed since. */
  protected closePanel(): void {
    this.panel.set(null);
    this.menu.focusAnchor();
  }
}
