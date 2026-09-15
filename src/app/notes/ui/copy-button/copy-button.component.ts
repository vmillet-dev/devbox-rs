import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ClipboardService } from '@core/services/clipboard/clipboard.service';

/** Long enough to be seen, short enough not to follow the mouse to the next card. */
const FEEDBACK_MS = 2000;

@Component({
  selector: 'app-copy-button',
  imports: [TranslocoPipe],
  templateUrl: './copy-button.component.html',
  styleUrl: './copy-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyButtonComponent {
  private readonly clipboard = inject(ClipboardService);

  readonly value = input.required<string>();
  readonly showLabel = input(false);

  readonly label = input('notes.copyContent');

  protected readonly copied = signal(false);

  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimeout());
  }

  /** `stopPropagation` because the host card is itself an opening button. */
  protected async onCopy(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    if (!(await this.clipboard.copy(this.value()))) return;

    this.copied.set(true);
    this.clearTimeout();
    this.timeout = setTimeout(() => {
      this.timeout = null;
      this.copied.set(false);
    }, FEEDBACK_MS);
  }

  private clearTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
