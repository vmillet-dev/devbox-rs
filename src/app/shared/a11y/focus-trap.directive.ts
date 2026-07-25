import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Confine le focus clavier à l'intérieur de l'élément, et le restitue à sa
 * position d'origine à la destruction.
 *
 * Sans ça, une boîte de dialogue n'est pas utilisable au clavier : le focus
 * reste sur l'élément qui l'a ouverte, `Tab` promène l'utilisateur dans le
 * contenu masqué derrière la modale, et la fermeture perd le focus dans le vide.
 *
 * Écrit à la main plutôt qu'en tirant `@angular/cdk` pour une seule directive —
 * même arbitrage que la coloration JSON de `CodeViewerComponent`.
 */
@Directive({
  selector: '[appFocusTrap]',
  host: {
    '(keydown.tab)': 'onTab($event, false)',
    '(keydown.shift.tab)': 'onTab($event, true)',
  },
})
export class FocusTrapDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private previouslyFocused: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    this.focusableElements()[0]?.focus();
  }

  ngOnDestroy(): void {
    this.previouslyFocused?.focus();
  }

  // `Event` et non `KeyboardEvent` : les pseudo-événements à modificateur
  // (`keydown.tab`) ne figurent pas dans la table de types des host bindings,
  // et `typeCheckHostBindings` y fournit donc un `Event` générique.
  // Seul `preventDefault()` est utilisé ici, le type de base suffit.
  protected onTab(event: Event, backwards: boolean): void {
    const elements = this.focusableElements();
    if (elements.length === 0) return;

    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = document.activeElement;

    // Seuls les deux bords du piège demandent une intervention : entre les deux,
    // la navigation native fait déjà ce qu'il faut.
    if (backwards && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!backwards && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }
}
