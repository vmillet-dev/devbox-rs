import { Directive, output } from '@angular/core';

/**
 * A modal's backdrop: emits `dismissed` when the click lands on the backdrop
 * itself and not on the panel above it.
 *
 * The listener lives here rather than in the template, which avoids disabling
 * `click-events-have-key-events` there: the keyboard equivalent exists — it is
 * Escape, and every modal already handles it.
 */
@Directive({
  selector: '[appDialogBackdrop]',
  host: {
    '(click)': 'onClick($event)',
  },
})
export class DialogBackdropDirective {
  readonly dismissed = output<void>();

  protected onClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.dismissed.emit();
    }
  }
}
