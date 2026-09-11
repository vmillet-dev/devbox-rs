import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppMenuEntry, AppMenuRegistry } from '@core/menu/app-menu.registry';
import { AppWindowService } from '@core/window/app-window.service';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';
import { SettingsDialogComponent } from '@layout/settings-dialog/settings-dialog.component';

/**
 * The titlebar's "File" menu, next to "About" — the desktop convention.
 *
 * It runs nothing itself except quitting: the entries come from
 * [`AppMenuRegistry`], where the features register them. The titlebar stays
 * ignorant of the notes, and a future tool will add its own entries without
 * touching this file.
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
   * The menu closes on the action: the report shows under the titlebar
   * (`StatusToastComponent`) and not in the panel — a native file picker covers
   * it, and reopening the menu to read the result would be absurd.
   */
  protected run(entry: AppMenuEntry): void {
    if (entry.disabled?.()) return;

    entry.run();
    this.menu.close(false);
  }

  /**
   * The preferences do not go through the registry: they set the application
   * itself and not a feature, so the menu always offers them, like "Quit".
   */
  protected openSettings(): void {
    this.settingsOpen.set(true);
    // No focus restored: the modal opening takes it itself.
    this.menu.close(false);
  }

  /**
   * The modal's focus trap would hand back to the element active when it
   * opened — the menu entry, destroyed since. Focus therefore returns to the
   * trigger, the only landmark still on screen.
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
