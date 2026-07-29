import { ChangeDetectionStrategy, Component, ElementRef, input, model, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Le raccourci diffère selon la plateforme : afficher « ⌘K » sur Windows
 * (où DevBox tourne aussi) désignerait une touche qui n'existe pas.
 */
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
   * Le raccourci est désactivé tant qu'une modale est ouverte : sinon il
   * déplacerait le focus vers un champ situé *derrière* la boîte de dialogue,
   * et l'utilisateur taperait dans un contrôle qu'il ne voit pas.
   */
  readonly shortcutEnabled = input(true);

  protected readonly shortcutHint = platformShortcutHint();

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  /**
   * Le raccourci est porté par le composant qui en affiche l'indice et qui
   * possède le champ, plutôt que remonté à la page par une chaîne de
   * `viewChild` traversant deux niveaux de composants.
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
