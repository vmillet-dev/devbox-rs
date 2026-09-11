import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { NotesRepository } from '../data/notes.repository';
import { Variable, duplicateNames, toVariableRecord } from '../model/variable.model';

/**
 * Les variables globales, telles que le panneau de préférences les édite.
 *
 * L'état local est une **liste**, pas la carte que le back renvoie : une ligne
 * qu'on vient d'ajouter n'a encore ni nom ni valeur, et une carte l'aurait
 * perdue à la frappe suivante. La conversion n'a lieu qu'à l'enregistrement.
 *
 * Écriture à la sortie du champ, comme partout ailleurs dans l'application : il
 * n'y a pas de bouton « Enregistrer », et un aller-retour IPC par caractère
 * serait gâché.
 */
@Injectable({ providedIn: 'root' })
export class VariablesStore {
  private readonly repository = inject(NotesRepository);
  private readonly notifier = inject(ErrorNotifier);

  private readonly _variables = signal<readonly Variable[]>([]);
  private readonly _isLoading = signal(false);

  readonly variables = this._variables.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isEmpty = computed(() => !this._isLoading() && this._variables().length === 0);

  /** Deux lignes de même nom : la seconde écrase la première à l'écriture. */
  readonly duplicates = computed(() => duplicateNames(this._variables()));

  async load(): Promise<void> {
    this._isLoading.set(true);
    try {
      const stored = await this.repository.loadVariables();
      this._variables.set(Object.entries(stored).map(([name, value]) => ({ name, value })));
    } catch (error) {
      this.notifier.reportFailure('errors.variablesLoadFailed', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  /** Une ligne vide, à remplir : rien n'est écrit tant qu'elle l'est. */
  add(): void {
    this._variables.update((variables) => [...variables, { name: '', value: '' }]);
  }

  rename(index: number, name: string): void {
    this.replace(index, (variable) => ({ ...variable, name: name.trim() }));
  }

  setValue(index: number, value: string): void {
    this.replace(index, (variable) => ({ ...variable, value }));
  }

  /** Retirer, c'est écrire : la ligne ne reviendra pas d'un blur. */
  async remove(index: number): Promise<void> {
    this._variables.update((variables) => variables.filter((_, position) => position !== index));
    await this.commit();
  }

  /**
   * Envoie le **jeu complet**. Ce que le back retient n'est pas réadopté ici :
   * il laisse tomber les lignes à moitié remplies, qui doivent rester à l'écran
   * le temps d'être terminées.
   */
  async commit(): Promise<void> {
    try {
      await this.repository.saveVariables(toVariableRecord(this._variables()));
    } catch (error) {
      this.notifier.reportFailure('errors.variablesSaveFailed', error);
    }
  }

  private replace(index: number, change: (variable: Variable) => Variable): void {
    this._variables.update((variables) =>
      variables.map((variable, position) => (position === index ? change(variable) : variable)),
    );
  }
}
