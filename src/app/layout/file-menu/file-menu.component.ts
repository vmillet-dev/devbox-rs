import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppMenuEntry, AppMenuRegistry } from '@core/menu/app-menu.registry';
import { AppWindowService } from '@core/window/app-window.service';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';
import { SettingsDialogComponent } from '@layout/settings-dialog/settings-dialog.component';

/**
 * It runs nothing itself except quitting: the entries come from [`AppMenuRegistry`],
 * where the features register them, so the titlebar stays ignorant of the notes.
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

  /** Quitting closes the application for good: a second click confirms it. */
  protected readonly confirmingQuit = signal(false);

  protected readonly settingsOpen = signal(false);

  constructor() {
    this.menu.escaped.subscribe(() => this.menu.close());
    this.menu.closed.subscribe(() => this.confirmingQuit.set(false));
  }

  /**
   * The report shows under the titlebar and not in the panel: the menu closes on the
   * action, and a native file picker would cover it.
   */
  protected run(entry: AppMenuEntry): void {
    if (entry.disabled?.()) return;

    entry.run();
    this.menu.close(false);
  }

  /**
   * The preferences set the application itself and not a feature, so the menu always
   * offers them, like "Quit".
   */
  protected openSettings(): void {
    this.settingsOpen.set(true);
    // No focus restored: the modal opening takes it itself.
    this.menu.close(false);
  }

  /**
   * The modal's focus trap would hand back to the menu entry, destroyed since: focus
   * returns to the trigger, the only landmark still on screen.
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
