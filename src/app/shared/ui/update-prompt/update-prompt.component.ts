import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TranslationRef } from '@core/models/translation-ref.model';
import { UpdateStore } from '@core/updates/update.store';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';

/**
 * Pop-in proposant une mise à jour, affichée dès qu'une version plus récente
 * est publiée.
 *
 * Le composant ne décide de rien : il rend l'état de `UpdateStore` et lui
 * renvoie le choix de l'utilisateur. Une fois l'installation lancée, les deux
 * boutons disparaissent — Échap et le clic sur le fond aussi — parce qu'il n'y
 * a plus rien à annuler : l'installateur est en train de remplacer les fichiers.
 */
@Component({
  selector: 'app-update-prompt',
  imports: [FocusTrapDirective, TranslocoPipe],
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

  protected onEscape(): void {
    if (this.store.update() && !this.busy()) {
      this.later();
    }
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget && !this.busy()) {
      this.later();
    }
  }
}
