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
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Space } from '@core/models/space.model';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';

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
  imports: [TranslocoPipe, MenuPanelDirective],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './space-switcher.component.html',
  styleUrl: './space-switcher.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  protected readonly menu = inject(MenuTriggerDirective);

  protected readonly creating = signal(false);

  /**
   * Espace en cours d'édition. Le panneau **remplace** le menu au lieu de s'y
   * ajouter, comme le formulaire de création : des champs de saisie dans un
   * `role="menu"` ne sont ni valides ARIA, ni navigables comme des options.
   */
  protected readonly editing = signal<Space | null>(null);

  /** Suppression en deux temps : la WebView bloque tout pendant un `confirm()` natif. */
  protected readonly confirmingDelete = signal(false);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  /**
   * Refuges possibles pour les notes de l'espace édité. Un espace ne peut pas
   * être le sien : la cascade emporterait les notes juste après le transfert.
   * Liste vide ⇒ suppression impossible, et le panneau le dit plutôt que
   * d'offrir un bouton qui échouerait.
   */
  protected readonly moveTargets = computed<readonly Space[]>(() => {
    const edited = this.editing();
    return edited ? this.spaces().filter((space) => space.id !== edited.id) : [];
  });

  constructor() {
    this.menu.escaped.subscribe(() => this.onEscape());
    this.menu.closed.subscribe(() => this.resetPanels());

    // Les panneaux remplacent le menu, dont `MenuPanelDirective` gère le focus :
    // seuls leurs champs de saisie restent à cadrer ici.
    effect(() => {
      if (!this.menu.open()) return;
      if (this.editing()) {
        this.renameInput()?.nativeElement.focus();
      } else if (this.creating()) {
        this.nameInput()?.nativeElement.focus();
      }
    });
  }

  protected toggle(): void {
    this.menu.toggle();
    this.resetPanels();
  }

  protected select(space: Space | null): void {
    this.spaceChanged.emit(space?.id ?? null);
    this.menu.close();
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
    this.menu.close();
  }

  protected submitRename(event: Event, name: string): void {
    event.preventDefault();
    const edited = this.editing();
    if (!edited || !name.trim()) return;

    this.spaceRenamed.emit({ id: edited.id, name });
    this.menu.close();
  }

  protected onDeleteClick(targetSpaceId: string): void {
    const edited = this.editing();
    if (!edited || !targetSpaceId) return;

    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.spaceDeleted.emit({ id: edited.id, targetSpaceId });
    this.menu.close();
  }

  /** Échap referme d'abord le panneau ouvert, puis le menu lui-même. */
  private onEscape(): void {
    if (this.editing() || this.creating()) {
      this.resetPanels();
      return;
    }
    this.menu.close();
  }

  private resetPanels(): void {
    this.creating.set(false);
    this.editing.set(null);
    this.confirmingDelete.set(false);
  }
}
