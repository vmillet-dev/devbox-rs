import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Space } from '@core/model/space.model';

@Component({
  selector: 'app-selection-bar',
  imports: [TranslocoPipe],
  templateUrl: './selection-bar.component.html',
  styleUrl: './selection-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectionBarComponent {
  readonly count = input.required<number>();
  readonly spaces = input<readonly Space[]>([]);

  readonly moveRequested = output<string>();
  readonly tagRequested = output<string>();
  /** The label announces the format: Markdown must not be a surprise. */
  readonly copyRequested = output<void>();
  readonly deleteRequested = output<void>();
  readonly cleared = output<void>();

  protected readonly tagDraft = signal('');

  /** Two steps: the WebView blocks on a native `confirm()`. */
  protected readonly confirmingDelete = signal(false);

  protected onMove(spaceId: string): void {
    if (spaceId) {
      this.moveRequested.emit(spaceId);
    }
  }

  protected submitTag(event: Event): void {
    event.preventDefault();
    const tag = this.tagDraft().trim();
    if (!tag) return;

    this.tagRequested.emit(tag);
    this.tagDraft.set('');
  }

  protected onDeleteClick(): void {
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.confirmingDelete.set(false);
    this.deleteRequested.emit();
  }
}
