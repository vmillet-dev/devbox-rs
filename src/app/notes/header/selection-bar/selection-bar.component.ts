import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Folder } from '@core/model/folder.model';
import { Space } from '@core/model/space.model';

/** Not a folder id, and not the empty string either — that one is the prompt. */
const UNFILE = '__unfile__';

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
  readonly folders = input<readonly Folder[]>([]);

  readonly moveRequested = output<string>();
  /** `null` takes the selection out of its folder; the two directions are one control. */
  readonly fileRequested = output<string | null>();
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

  /** The empty option is the prompt; "unfile" is an entry of its own. */
  protected onFile(value: string): void {
    if (value) {
      this.fileRequested.emit(value === UNFILE ? null : value);
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
