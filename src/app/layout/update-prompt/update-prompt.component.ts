import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/i18n/translation-ref.model';
import { UpdateStore } from '@core/updates/update.store';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';

/**
 * The prompt offering an update, shown as soon as a newer version is published.
 *
 * The component decides nothing: it renders `UpdateStore`'s state and hands
 * back the user's choice. Once installing starts both buttons disappear — and
 * so do Escape and the backdrop click — because there is nothing left to
 * cancel: the installer is replacing the files.
 */
@Component({
  selector: 'app-update-prompt',
  imports: [DialogBackdropDirective, FocusTrapDirective, TranslocoPipe],
  templateUrl: './update-prompt.component.html',
  styleUrl: './update-prompt.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class UpdatePromptComponent {
  protected readonly store = inject(UpdateStore);

  protected readonly busy = computed(
    () => this.store.status() === 'installing' || this.store.status() === 'installed',
  );

  protected readonly statusRef = computed<TranslationRef>(() => {
    if (this.store.status() === 'installed') return { key: 'update.restarting' };

    const percent = this.store.progressPercent();
    return percent === null
      ? { key: 'update.downloading' }
      : { key: 'update.downloadingPercent', params: { percent } };
  });

  protected install(): void {
    void this.store.accept();
  }

  protected later(): void {
    void this.store.dismiss();
  }

  /**
   * Escape and the backdrop click: two ways to postpone, refused while
   * installing — interrupting halfway would leave a half-replaced binary.
   */
  protected onEscape(): void {
    if (this.store.update() && !this.busy()) {
      this.later();
    }
  }
}
