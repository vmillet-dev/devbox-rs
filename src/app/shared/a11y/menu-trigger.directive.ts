import { Directive, ElementRef, inject, output, signal } from '@angular/core';

/**
 * État ouvert/fermé d'un menu déroulant, et les deux façons d'en sortir sans
 * cliquer une entrée : clic hors-zone et Échap.
 *
 * Posée sur l'élément racine du composant et lue via `exportAs` :
 * `<div appMenuTrigger #menu="appMenu">` puis `menu.open()`. Le déclencheur se
 * désigne par `[appMenuAnchor]` — c'est à lui que le focus revient à la
 * fermeture, sans quoi il disparaîtrait avec l'élément détruit et repartirait
 * sur `<body>`.
 *
 * Échap n'est pas traité ici mais émis : un menu à plusieurs niveaux doit
 * pouvoir replier son panneau avant de se fermer (cf. `SpaceSwitcher`).
 */
@Directive({
  selector: '[appMenuTrigger]',
  exportAs: 'appMenu',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'escaped.emit()',
  },
})
export class MenuTriggerDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  /** Échap pressé alors que le menu est ouvert. */
  readonly escaped = output<void>();
  /** Le menu vient de se fermer, quelle qu'en soit la cause. */
  readonly closed = output<void>();

  toggle(): void {
    if (this._open()) {
      this.close();
      return;
    }
    this._open.set(true);
  }

  /**
   * `restoreFocus` est laissé à `false` quand la fermeture ouvre autre chose qui
   * prendra le focus — la fiche « À propos », par exemple.
   */
  close(restoreFocus = true): void {
    if (!this._open()) return;

    this._open.set(false);
    this.closed.emit();
    if (restoreFocus) {
      this.focusAnchor();
    }
  }

  /** Ramène le focus sur le déclencheur, seul point de repère encore à l'écran. */
  focusAnchor(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[appMenuAnchor]')?.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this._open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close(false);
    }
  }
}
