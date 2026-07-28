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

/** Suppression d'un espace : ce qu'il faut savoir pour ne perdre aucune note. */
export interface SpaceDeletion {
  readonly id: string;
  /** Espace qui recueille les notes de celui qu'on supprime. */
  readonly targetSpaceId: string;
}

export interface SpaceRenaming {
  readonly id: string;
  /** Nom brut : le détourage et l'unicité appartiennent au back. */
  readonly name: string;
}

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
  readonly spaceRenamed = output<SpaceRenaming>();
  readonly spaceDeleted = output<SpaceDeletion>();

  protected readonly open = signal(false);
  protected readonly creating = signal(false);

  /**
   * Espace en cours d'édition. Le panneau **remplace** le menu au lieu de s'y
   * ajouter, comme le formulaire de création : des champs de saisie dans un
   * `role="menu"` ne sont ni valides ARIA, ni navigables comme des options.
   */
  protected readonly editing = signal<Space | null>(null);

  /** Suppression en deux temps : la WebView bloque tout pendant un `confirm()` natif. */
  protected readonly confirmingDelete = signal(false);

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly options = viewChildren<ElementRef<HTMLButtonElement>>('option');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  /**
   * Refuges possibles pour les notes de l'espace édité. Un espace ne peut pas
   * être le sien : la cascade du schéma emporterait les notes juste après le
   * transfert. Liste vide ⇒ la suppression est impossible, et le panneau le dit
   * plutôt que d'offrir un bouton qui échouerait.
   */
  protected readonly moveTargets = computed<readonly Space[]>(() => {
    const edited = this.editing();
    return edited ? this.spaces().filter((space) => space.id !== edited.id) : [];
  });

  constructor() {
    // Ouvrir un menu sans y amener le focus le rend inatteignable au clavier.
    // L'effet dépend aussi des requêtes de vue : au moment où `open` bascule,
    // elles ne sont pas encore à jour, il se rejoue donc dès qu'elles le sont.
    effect(() => {
      if (!this.open()) return;
      if (this.editing()) {
        this.renameInput()?.nativeElement.focus();
      } else if (this.creating()) {
        this.nameInput()?.nativeElement.focus();
      } else {
        this.options()[0]?.nativeElement.focus();
      }
    });
  }

  protected toggle(): void {
    this.open.update((value) => !value);
    this.resetPanels();
  }

  protected select(space: Space | null): void {
    this.spaceChanged.emit(space?.id ?? null);
    this.closeAndRestoreFocus();
  }

  protected startCreating(): void {
    this.creating.set(true);
  }

  protected startEditing(space: Space): void {
    this.editing.set(space);
    this.confirmingDelete.set(false);
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

  protected submitRename(event: Event, name: string): void {
    event.preventDefault();
    const edited = this.editing();
    if (!edited || !name.trim()) return;

    this.spaceRenamed.emit({ id: edited.id, name });
    this.closeAndRestoreFocus();
  }

  protected onDeleteClick(targetSpaceId: string): void {
    const edited = this.editing();
    if (!edited || !targetSpaceId) return;

    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.spaceDeleted.emit({ id: edited.id, targetSpaceId });
    this.closeAndRestoreFocus();
  }

  /** Échap referme d'abord le panneau ouvert, puis le menu lui-même. */
  protected onEscape(): void {
    if (this.editing() || this.creating()) {
      this.resetPanels();
      return;
    }
    this.closeAndRestoreFocus();
  }

  protected closeAndRestoreFocus(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.resetPanels();
    // Sans ça, le focus disparaît avec l'élément détruit et repart sur <body>.
    this.trigger().nativeElement.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
      this.resetPanels();
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

  private resetPanels(): void {
    this.creating.set(false);
    this.editing.set(null);
    this.confirmingDelete.set(false);
  }
}
