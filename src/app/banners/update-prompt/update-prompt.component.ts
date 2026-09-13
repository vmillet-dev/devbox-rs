import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/services/i18n/translation-ref.model';
import { UpdateStore } from '@core/services/updates/update.store';
import { DialogComponent } from '@shared/layout/dialog/dialog.component';

/**
 * Once installing starts both buttons disappear and the dialog stops being dismissible:
 * there is nothing left to cancel, the installer is replacing the files.
 */
@Component({
  selector: 'app-update-prompt',
  imports: [DialogComponent, TranslocoPipe],
  templateUrl: './update-prompt.component.html',
  styleUrl: './update-prompt.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdatePromptComponent {
  protected readonly store = inject(UpdateStore);

  /**
   * Local, and read on the way out: Escape and the backdrop close the dialog without
   * touching the buttons, and both have to honour a box the user has already ticked.
   */
  protected readonly skip = signal(false);

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
    void this.store.dismiss(this.skip());
  }
}
