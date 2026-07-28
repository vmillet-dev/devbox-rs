import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Space } from '@core/models/space.model';

/**
 * Menu d'actions d'une carte de note : déplacer vers un autre espace, supprimer.
 *
 * Composant séparé de `NoteCardComponent` parce qu'il apporte ce que la carte
 * n'a pas : un état ouvert/fermé, une écoute du clic global et une gestion du
 * focus. La carte reste ainsi purement dérivée de sa note.
 *
 * Il n'émet **jamais l'identifiant de la note** — il ne le connaît pas. C'est la
 * carte qui l'ajoute en relayant, comme l'éditeur laisse le store décider de la
 * note ouverte.
 */
@Component({
  selector: 'app-note-card-menu',
  imports: [TranslocoPipe],
  templateUrl: './note-card-menu.component.html',
  styleUrl: './note-card-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'onEscape()',
  },
})
export class NoteCardMenuComponent {
  /** Titre déjà affichable : la carte a résolu le libellé de remplacement. */
  readonly noteTitle = input.required<string>();
  readonly spaces = input.required<readonly Space[]>();
  readonly currentSpaceId = input.required<string>();

  /** Identifiant de l'espace de destination. */
  readonly moveRequested = output<string>();
  readonly deleteRequested = output<void>();

  protected readonly open = signal(false);

  /** Suppression en deux temps : la WebView bloque tout pendant un `confirm()` natif. */
  protected readonly confirmingDelete = signal(false);

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly items = viewChildren<ElementRef<HTMLButtonElement>>('item');

  /** Déplacer une note là où elle est déjà n'a pas de sens : l'espace courant est retiré. */
  protected readonly moveTargets = computed<readonly Space[]>(() =>
    this.spaces().filter((space) => space.id !== this.currentSpaceId()),
  );

  constructor() {
    // Ouvrir un menu sans y amener le focus le rend inatteignable au clavier.
    // `items()` participe à la dépendance : la requête de vue n'est pas à jour
    // au moment où `open` bascule, l'effet se rejoue dès qu'elle l'est.
    effect(() => {
      if (this.open()) {
        this.items()[0]?.nativeElement.focus();
      }
    });
  }

  protected toggle(event: MouseEvent): void {
    // La carte entière est un bouton d'ouverture : sans ça, un clic sur le ⋯
    // remonterait jusqu'à elle et ouvrirait l'éditeur en même temps que le menu.
    event.stopPropagation();
    this.open.update((value) => !value);
    this.confirmingDelete.set(false);
  }

  protected move(spaceId: string): void {
    this.moveRequested.emit(spaceId);
    this.closeAndRestoreFocus();
  }

  protected onDeleteClick(): void {
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.deleteRequested.emit();
    this.closeAndRestoreFocus();
  }

  protected onEscape(): void {
    this.closeAndRestoreFocus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
      this.confirmingDelete.set(false);
    }
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = this.items().map((ref) => ref.nativeElement);
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (index: number): void => {
      event.preventDefault();
      items[(index + items.length) % items.length].focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        focusAt(currentIndex + 1);
        break;
      case 'ArrowUp':
        focusAt(currentIndex - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
    }
  }

  private closeAndRestoreFocus(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.confirmingDelete.set(false);
    // Sans ça, le focus disparaît avec l'élément détruit et repart sur <body>.
    this.trigger().nativeElement.focus();
  }
}
