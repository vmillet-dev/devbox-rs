import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { VariablesStore } from '@features/notes/state/variables.store';
import { Variable, isVariableName } from '@features/notes/model/variable.model';

function typedValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

/**
 * Page « Variables » du panneau de préférences : les valeurs de `{{champs}}`
 * valables pour tout le corpus.
 *
 * Elle vit dans `features/notes/` et non dans `layout/` : un `{{champ}}` est du
 * vocabulaire de notes. Le panneau l'affiche sans la connaître, par
 * [`SettingsRegistry`] — c'est `NotesPageComponent` qui l'y inscrit.
 *
 * Ces valeurs ne sont qu'une **proposition** : ce qui a été saisi sur une note
 * passe devant, et le champ resté vide dans l'éditeur affiche la variable en
 * gris plutôt que de la recopier.
 */
@Component({
  selector: 'app-variables-page',
  imports: [TranslocoPipe],
  templateUrl: './variables-page.component.html',
  styleUrl: './variables-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VariablesPageComponent {
  protected readonly store = inject(VariablesStore);

  constructor() {
    void this.store.load();
  }

  /** Vide tant qu'on n'a rien tapé : une ligne neuve n'est pas une faute. */
  protected isRejected(variable: Variable): boolean {
    return variable.name !== '' && !isVariableName(variable.name);
  }

  protected onName(index: number, event: Event): void {
    this.store.rename(index, typedValue(event));
  }

  protected onValue(index: number, event: Event): void {
    this.store.setValue(index, typedValue(event));
  }

  protected commit(): void {
    void this.store.commit();
  }

  protected remove(index: number): void {
    void this.store.remove(index);
  }
}
