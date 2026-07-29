import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Space } from '@core/models/space.model';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';

/**
 * Menu d'actions d'une carte : déplacer vers un autre espace, supprimer.
 *
 * Séparé de `NoteCardComponent` parce qu'il apporte ce que la carte n'a pas : un
 * état ouvert/fermé et une gestion du focus. La carte reste dérivée de sa note.
 *
 * Il n'émet **jamais l'identifiant de la note** — il ne le connaît pas. C'est la
 * carte qui l'ajoute en relayant.
 */
@Component({
  selector: 'app-note-card-menu',
  imports: [TranslocoPipe, MenuPanelDirective],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './note-card-menu.component.html',
  styleUrl: './note-card-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCardMenuComponent {
  /** Titre déjà affichable : la carte a résolu le libellé de remplacement. */
  readonly noteTitle = input.required<string>();
  readonly spaces = input.required<readonly Space[]>();
  readonly currentSpaceId = input.required<string>();

  /** Identifiant de l'espace de destination. */
  readonly moveRequested = output<string>();
  readonly deleteRequested = output<void>();

  protected readonly menu = inject(MenuTriggerDirective);

  constructor() {
    this.menu.escaped.subscribe(() => this.menu.close());
  }

  /**
   * Suppression en deux temps : la WebView bloque tout pendant un `confirm()`
   * natif. Réinitialisée à chaque ouverture comme à chaque fermeture — une
   * confirmation en cours ne doit pas survivre à la sortie du menu.
   */
  protected readonly confirmingDelete = linkedSignal({
    source: this.menu.open,
    computation: () => false,
  });

  /** Déplacer une note là où elle est déjà n'a pas de sens. */
  protected readonly moveTargets = computed<readonly Space[]>(() =>
    this.spaces().filter((space) => space.id !== this.currentSpaceId()),
  );

  protected toggle(event: MouseEvent): void {
    // La carte entière est un bouton d'ouverture : sans ça, un clic sur le ⋯
    // remonterait jusqu'à elle et ouvrirait l'éditeur en même temps que le menu.
    event.stopPropagation();
    this.menu.toggle();
  }

  protected move(spaceId: string): void {
    this.moveRequested.emit(spaceId);
    this.menu.close();
  }

  protected onDeleteClick(): void {
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.deleteRequested.emit();
    this.menu.close();
  }
}
