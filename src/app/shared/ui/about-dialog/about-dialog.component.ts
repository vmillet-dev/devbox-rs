import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AUTHOR_HANDLE, AUTHOR_NAME, REPOSITORY_URL } from '@core/app-info/app-info';
import { AppInfoService } from '@core/app-info/app-info.service';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';

/** Affichage du dépôt : l'URL sans son schéma, plus lisible et suffisante. */
const REPOSITORY_LABEL = REPOSITORY_URL.replace(/^https:\/\//, '');

/**
 * Fiche « À propos » : version, description du projet, développeur et dépôt.
 *
 * Purement informative — la recherche de mise à jour vit dans le menu qui ouvre
 * cette fiche, pas ici.
 */
@Component({
  selector: 'app-about-dialog',
  imports: [FocusTrapDirective, TranslocoPipe],
  templateUrl: './about-dialog.component.html',
  styleUrl: './about-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class AboutDialogComponent {
  private readonly appInfo = inject(AppInfoService);

  readonly closed = output<void>();

  protected readonly version = this.appInfo.version;
  protected readonly authorName = AUTHOR_NAME;
  protected readonly authorHandle = AUTHOR_HANDLE;
  protected readonly repositoryLabel = REPOSITORY_LABEL;

  protected openRepository(): void {
    void this.appInfo.openRepository();
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }
}
