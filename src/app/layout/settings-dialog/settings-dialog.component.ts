import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsPage, SettingsRegistry } from '@core/settings/settings-registry';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { SettingsPageComponent } from './settings-page/settings-page.component';

/**
 * The application's own settings, always present: unlike the registry's pages
 * they depend on no loaded tool.
 */
const GENERAL_PAGE: SettingsPage = {
  id: 'general',
  labelKey: 'settings.pages.general',
  order: 10,
  component: SettingsPageComponent,
};

/**
 * The preferences panel: a rail of pages on the left, the chosen page on the
 * right.
 *
 * It knows one page, its own. The others come from [`SettingsRegistry`], where
 * the features register them — importing one here would break the rule that
 * deleting a feature's folder deletes the feature.
 *
 * **No "OK / Cancel / Apply".** Everything applies as it is typed: it is
 * already the application's idiom, and a theme you only see after confirming is
 * guessed at rather than chosen.
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
   * The page shown. Falls back to the first when nothing was chosen — or when
   * the feature carrying the chosen page has just been unloaded.
   */
  protected readonly activePage = computed<SettingsPage>(() => {
    const pages = this.pages();
    const requested = pages.find((page) => page.id === this.requestedPageId());

    // `GENERAL_PAGE` is always in the list, so the last fallback never fires.
    return requested ?? pages[0] ?? GENERAL_PAGE;
  });

  protected select(id: string): void {
    this.requestedPageId.set(id);
  }
}
