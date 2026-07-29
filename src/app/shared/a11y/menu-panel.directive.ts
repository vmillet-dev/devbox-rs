import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Navigation clavier d'un panneau `role="menu"` : focus sur la première entrée à
 * l'ouverture, puis flèches et Home/End avec bouclage.
 *
 * Le parcours suit les éléments marqués `appMenuItem`, et non tous les boutons :
 * un menu peut porter une action secondaire volontairement hors du cycle — le
 * « ⋯ » d'édition d'un espace se prend à la tabulation, pas aux flèches.
 *
 * Le focus initial est indispensable — un menu ouvert sans focus est
 * inatteignable au clavier. Il est posé par `afterNextRender` : la directive
 * n'existe qu'une fois le panneau créé par le `@if`, donc ses entrées sont déjà
 * là, là où un effet extérieur devait dépendre d'une requête de vue pas encore
 * à jour.
 *
 * L'écoute est déléguée depuis le conteneur, qui n'est jamais focusé : le rendre
 * focusable ajouterait un arrêt de tabulation parasite dans le menu.
 */
@Directive({
  selector: '[appMenuPanel]',
  host: {
    role: 'menu',
    '(keydown)': 'onKeydown($event)',
  },
})
export class MenuPanelDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => this.items()[0]?.focus());
  }

  protected onKeydown(event: KeyboardEvent): void {
    const items = this.items();
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (index: number): void => {
      event.preventDefault();
      items[(index + items.length) % items.length].focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        focusAt(current + 1);
        break;
      case 'ArrowUp':
        focusAt(current - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
    }
  }

  private items(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[appMenuItem]'));
  }
}
