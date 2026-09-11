import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Placeholder } from '@features/notes/model/note.model';

/** Une valeur saisie, telle qu'elle part vers le parent. */
export interface PlaceholderValue {
  readonly name: string;
  readonly value: string;
}

/**
 * Les lignes de saisie des `{{champs}}`, et rien d'autre.
 *
 * Extrait parce que deux écrans les affichent — le panneau de l'éditeur et la
 * modale de copie — et qu'ils doivent poser exactement la même question :
 * dériver l'un de l'autre finirait par donner deux sémantiques du champ vide.
 *
 * Il ne tient aucun état : le parent porte les valeurs, parce que l'un les
 * enregistre et l'autre les jette une fois la copie faite.
 *
 * ⚠️ Un champ vide affiche sa valeur par défaut en **suggestion**, il ne la
 * recopie pas : vide veut dire « je garde ce que le snippet propose », et
 * recopier `5432` figerait cette réponse le jour où le texte propose autre chose.
 */
@Component({
  selector: 'app-placeholder-fields',
  imports: [TranslocoPipe],
  templateUrl: './placeholder-fields.component.html',
  styleUrl: './placeholder-fields.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderFieldsComponent {
  readonly placeholders = input.required<readonly Placeholder[]>();

  /** Valeurs courantes, par nom de champ. Absent = rien de saisi. */
  readonly values = input.required<Record<string, string>>();

  readonly changed = output<PlaceholderValue>();

  protected valueOf(name: string): string {
    return this.values()[name] ?? '';
  }
}
