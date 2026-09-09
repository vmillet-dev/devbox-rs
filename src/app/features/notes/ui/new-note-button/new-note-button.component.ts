import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NoteKind } from '@features/notes/model/note.model';
import { MenuPanelDirective } from '@shared/a11y/menu-panel.directive';
import { MenuTriggerDirective } from '@shared/a11y/menu-trigger.directive';

/**
 * Bouton scindé : l'action par défaut crée une note ordinaire, le chevron
 * déroule le choix du type.
 *
 * Scindé et non purement déroulant, parce que les deux gestes n'ont pas la même
 * fréquence : créer une note reste le cas courant et garde un clic, choisir un
 * type en demande deux. Un menu qui s'ouvrirait à chaque création aurait
 * transformé le geste le plus fréquent en le plus lent.
 *
 * Même mécanique que le sélecteur d'espaces — `MenuTriggerDirective` pour
 * l'ouverture, le clic hors-zone et Échap, `MenuPanelDirective` pour les
 * flèches. Il n'existe volontairement pas de composant déroulant partagé : ce
 * qui se factorise ici, c'est le comportement, pas la présentation.
 */
@Component({
  selector: 'app-new-note-button',
  imports: [TranslocoPipe, MenuPanelDirective],
  hostDirectives: [MenuTriggerDirective],
  templateUrl: './new-note-button.component.html',
  styleUrl: './new-note-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewNoteButtonComponent {
  readonly created = output<NoteKind>();

  protected readonly menu = inject(MenuTriggerDirective);

  constructor() {
    // La directive émet Échap sans le traiter : ici il n'y a qu'un niveau à
    // replier, contrairement au sélecteur d'espaces.
    this.menu.escaped.subscribe(() => this.menu.close());
  }

  protected create(kind: NoteKind): void {
    this.created.emit(kind);
    this.menu.close();
  }
}
