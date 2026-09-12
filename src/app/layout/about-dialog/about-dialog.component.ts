import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { APP_INFO, AppInfoService } from '@core/app-info/app-info.service';
import { DialogComponent } from '@shared/ui/dialog/dialog.component';

const REPOSITORY_LABEL = APP_INFO.repository.replace(/^https:\/\//, '');

/** Purely informative — the update check lives in the menu that opens this card. */
@Component({
  selector: 'app-about-dialog',
  imports: [DialogComponent, TranslocoPipe],
  templateUrl: './about-dialog.component.html',
  styleUrl: './about-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutDialogComponent {
  private readonly appInfo = inject(AppInfoService);

  readonly closed = output<void>();

  protected readonly version = this.appInfo.version;
  protected readonly authorName = APP_INFO.author;
  protected readonly authorHandle = APP_INFO.authorHandle;
  protected readonly repositoryLabel = REPOSITORY_LABEL;

  protected openRepository(): void {
    void this.appInfo.openRepository();
  }
}
