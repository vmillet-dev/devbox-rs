import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { NotesRepository } from '../data/notes.repository';
import { Variable, duplicateNames, toVariableRecord } from '../model/variable.model';

/**
 * ⚠️ The local state is a **list**, not the map the back end returns: a row just added
 * has neither name nor value yet, and a map would lose it on the next keystroke.
 * Writes on field exit, as everywhere else here: there is no "Save" button.
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

  /** Two rows with the same name: the second overwrites the first on write. */
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

  /** An empty row to fill in: nothing is written while it stays empty. */
  add(): void {
    this._variables.update((variables) => [...variables, { name: '', value: '' }]);
  }

  rename(index: number, name: string): void {
    this.replace(index, (variable) => ({ ...variable, name: name.trim() }));
  }

  setValue(index: number, value: string): void {
    this.replace(index, (variable) => ({ ...variable, value }));
  }

  /** Removing is writing: the row will not come back from a blur. */
  async remove(index: number): Promise<void> {
    this._variables.update((variables) => variables.filter((_, position) => position !== index));
    await this.commit();
  }

  /**
   * Sends the **whole** set. What the back end keeps is not adopted back here: it
   * drops half-filled rows, which have to stay on screen long enough to be finished.
   */
  async commit(): Promise<void> {
    await this.notifier.attempt('errors.variablesSaveFailed', () =>
      this.repository.saveVariables(toVariableRecord(this._variables())),
    );
  }

  private replace(index: number, change: (variable: Variable) => Variable): void {
    this._variables.update((variables) =>
      variables.map((variable, position) => (position === index ? change(variable) : variable)),
    );
  }
}
