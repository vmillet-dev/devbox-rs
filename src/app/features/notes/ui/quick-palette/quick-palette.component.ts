import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';
import { Note } from '@features/notes/model/note.model';

const SNIPPET_LINES = 2;

/**
 * Palette de collage rapide : chercher, choisir, coller ailleurs.
 *
 * Pas de piège à focus ici, contrairement aux autres modales : le champ garde le
 * focus du début à la fin, et la liste se parcourt aux flèches sans jamais le
 * lui prendre — d'où `aria-activedescendant` plutôt qu'un focus déplacé, qui
 * ferait perdre la frappe en cours.
 */
@Component({
  selector: 'app-quick-palette',
  imports: [DialogBackdropDirective, LanguageBadgeComponent, TranslocoPipe],
  templateUrl: './quick-palette.component.html',
  styleUrl: './quick-palette.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickPaletteComponent {
  readonly query = input('');
  readonly results = input.required<readonly Note[]>();
  readonly highlighted = input(0);
  /** La ligne « créer une note » ferme la liste : elle en est la dernière. */
  readonly canCreate = input(false);

  readonly queryChanged = output<string>();
  readonly highlightMoved = output<number>();
  readonly highlightSet = output<number>();
  readonly chosen = output<void>();
  readonly openRequested = output<string>();
  readonly closed = output<void>();

  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  constructor() {
    // Une palette ouverte sans focus obligerait à attraper le champ à la souris,
    // ce qui lui retirerait tout intérêt.
    afterNextRender(() => this.searchInput().nativeElement.focus());
  }

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
        // Ouvrir plutôt que copier : la palette sert aussi à retrouver une note
        // pour l'éditer. Tab n'a rien d'autre à faire ici, le champ est seul —
        // et rien à ouvrir sur la ligne de création, qui ne désigne aucune note.
        const note = this.results()[this.highlighted()];
        if (note) {
          event.preventDefault();
          this.openRequested.emit(note.id);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.closed.emit();
        break;
    }
  }
}
