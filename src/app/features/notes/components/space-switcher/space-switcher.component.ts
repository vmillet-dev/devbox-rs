import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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

@Component({
  selector: 'app-space-switcher',
  imports: [TranslocoPipe],
  templateUrl: './space-switcher.component.html',
  styleUrl: './space-switcher.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'onEscape()',
  },
})
export class SpaceSwitcherComponent {
  readonly spaces = input.required<readonly Space[]>();
  /** `null` = « tous les espaces », un choix à part entière et non un état d'attente. */
  readonly activeSpace = input.required<Space | null>();

  /** `null` pour « tous les espaces ». */
  readonly spaceChanged = output<string | null>();
  /** Nom brut saisi : la normalisation et la persistance appartiennent au store. */
  readonly spaceCreated = output<string>();

  protected readonly open = signal(false);
  protected readonly creating = signal(false);

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly options = viewChildren<ElementRef<HTMLButtonElement>>('option');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  constructor() {
    // Ouvrir un menu sans y amener le focus le rend inatteignable au clavier.
    // L'effet dépend aussi de `options()` / `nameInput()` : au moment où `open`
    // bascule, la requête de vue n'est pas encore à jour, il se rejoue donc dès
    // qu'elle l'est.
    effect(() => {
      if (!this.open()) return;
      if (this.creating()) {
        this.nameInput()?.nativeElement.focus();
      } else {
        this.options()[0]?.nativeElement.focus();
      }
    });
  }

  protected toggle(): void {
    this.open.update((value) => !value);
    this.creating.set(false);
  }

  protected select(space: Space | null): void {
    this.spaceChanged.emit(space?.id ?? null);
    this.closeAndRestoreFocus();
  }

  protected startCreating(): void {
    this.creating.set(true);
  }

  /**
   * `submit` et non `click` : le formulaire répond ainsi aussi à la touche
   * Entrée, qui est la façon naturelle de valider un champ de texte.
   */
  protected submitNewSpace(event: Event, name: string): void {
    event.preventDefault();
    if (!name.trim()) return;

    this.spaceCreated.emit(name);
    this.closeAndRestoreFocus();
  }

  /** Échap referme d'abord le formulaire de création, puis le menu. */
  protected onEscape(): void {
    if (this.creating()) {
      this.creating.set(false);
      return;
    }
    this.closeAndRestoreFocus();
  }

  protected closeAndRestoreFocus(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.creating.set(false);
    // Sans ça, le focus disparaît avec l'élément détruit et repart sur <body>.
    this.trigger().nativeElement.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
      this.creating.set(false);
    }
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = this.options().map((ref) => ref.nativeElement);
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
}
