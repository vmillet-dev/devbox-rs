import { Directive, output } from '@angular/core';

/**
 * Fond d'une modale : émet `dismissed` quand le clic tombe sur le fond lui-même
 * et non sur le panneau posé dessus.
 *
 * L'écouteur vit ici plutôt que dans le template, ce qui évite d'y désactiver
 * `click-events-have-key-events` : l'équivalent clavier existe, c'est Échap, et
 * chaque modale le gère déjà.
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
