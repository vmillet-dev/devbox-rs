import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogComponent } from '@shared/ui/dialog/dialog.component';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';
import { Note } from '@features/notes/model/note.model';

const SNIPPET_LINES = 2;

/**
 * The quick-paste palette: search, choose, paste elsewhere.
 *
 * The field keeps focus from start to finish and the list is walked with the
 * arrows without ever taking it — hence `aria-activedescendant` rather than a
 * moved focus, which would lose what is being typed.
 */
@Component({
  selector: 'app-quick-palette',
  imports: [DialogComponent, LanguageBadgeComponent, TranslocoPipe],
  templateUrl: './quick-palette.component.html',
  styleUrl: './quick-palette.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickPaletteComponent {
  readonly query = input('');
  readonly results = input.required<readonly Note[]>();
  readonly highlighted = input(0);
  /** The "create a note" row closes the list: it is the last one. */
  readonly canCreate = input(false);

  readonly queryChanged = output<string>();
  readonly highlightMoved = output<number>();
  readonly highlightSet = output<number>();
  readonly chosen = output<void>();
  readonly openRequested = output<string>();
  readonly closed = output<void>();

  protected snippetOf(note: Note): string {
    return note.content.split('\n').slice(0, SNIPPET_LINES).join('\n');
  }

  protected optionId(index: number): string {
    return `palette-option-${index}`;
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.highlightMoved.emit(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.highlightMoved.emit(-1);
        break;
      case 'Enter':
        event.preventDefault();
        this.chosen.emit();
        break;
      case 'Tab': {
        // Open rather than copy: the palette also serves to find a note to
        // edit. Tab has nothing else to do here, the field being alone — and
        // nothing to open on the create row, which names no note.
        const note = this.results()[this.highlighted()];
        if (note) {
          event.preventDefault();
          this.openRequested.emit(note.id);
        }
        break;
      }
    }
  }
}
