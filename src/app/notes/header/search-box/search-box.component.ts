import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
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

  /** Disabled while a modal is open: it would move focus to a field behind the dialog. */
  readonly shortcutEnabled = input(true);

  /** Takes the shortcut hint's place: the hint is needed before a search, the count after. */
  readonly matched = input<number | null>(null);

  /** Asked for from the count, which is the only thing on screen that says it is on. */
  readonly cleared = output<void>();

  protected readonly shortcutHint = platformShortcutHint();

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  /** Carried by the component that owns the field rather than lifted to the page. */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.shortcutEnabled()) return;
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;

    event.preventDefault();
    this.inputRef().nativeElement.focus();
  }

  /**
   * ⚠️ The field is inside the `<label>`, so a click here would focus it and hand the
   * user a cursor in a field they just emptied.
   */
  protected onClear(event: MouseEvent): void {
    event.preventDefault();
    this.cleared.emit();
  }

  protected onInput(value: string): void {
    this.query.set(value);
  }
}
