import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ClipboardService } from '@core/clipboard/clipboard.service';

/** How long the copy acknowledgement lasts: long enough to be seen, short enough not to follow the mouse to the next card. */
const FEEDBACK_MS = 2000;

/**
 * Copies a value to the clipboard and says so.
 *
 * In `features/` and not in `shared/`: it injects, and a `shared/` component
 * injects nothing.
 */
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
  /** Adds the label next to the icon, for a toolbar. */
  readonly showLabel = input(false);

  /**
   * The label's translation key. Settable because the same button says "Copy"
   * in a toolbar and "Copy as is" next to a fields panel, where **as is** is
   * what carries the information.
   */
  readonly label = input('notes.copyContent');

  protected readonly copied = signal(false);

  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimeout());
  }

  /**
   * `stopPropagation` because the host card is itself an opening button:
   * without it, copying would open the editor at the same time.
   */
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
