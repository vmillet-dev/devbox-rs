import { Injectable, inject } from '@angular/core';
import { ClipboardService } from '@core/clipboard/clipboard.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';

/**
 * A service rather than a method on whoever needs it: copying happens from the canvas,
 * from the editor and from the fields form, and an acknowledgement earned in only one
 * of the three would be a lie in the other two.
 */
@Injectable({ providedIn: 'root' })
export class NoteCopyService {
  private readonly clipboard = inject(ClipboardService);
  private readonly notifier = inject(ErrorNotifier);

  /** Answers what the clipboard actually accepted: an acknowledgement is earned. */
  async copy(content: string): Promise<boolean> {
    if (await this.clipboard.copy(content)) return true;

    this.notifier.notify({ ref: { key: 'errors.copyFailed' } });
    return false;
  }
}
