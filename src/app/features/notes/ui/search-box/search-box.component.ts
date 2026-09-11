import { ChangeDetectionStrategy, Component, ElementRef, input, model, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Showing "⌘K" on Windows would name a key that does not exist there. */
function platformShortcutHint(): string {
  return /mac/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K';
}

@Component({
  selector: 'app-search-box',
  imports: [TranslocoPipe],
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class SearchBoxComponent {
  readonly query = model('');

  /**
   * Disabled while a modal is open: it would otherwise move focus to a field *behind*
   * the dialog, into a control the user cannot see.
   */
  readonly shortcutEnabled = input(true);

  protected readonly shortcutHint = platformShortcutHint();

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  /**
   * Carried by the component that shows its hint and owns the field, rather than lifted
   * to the page through a chain of `viewChild`s crossing two levels.
   */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.shortcutEnabled()) return;
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;

    event.preventDefault();
    this.inputRef().nativeElement.focus();
  }

  protected onInput(value: string): void {
    this.query.set(value);
  }
}
