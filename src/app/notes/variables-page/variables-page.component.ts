import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { VariablesStore } from '@notes/state/variables.store';
import { Variable, isVariableName } from '@notes/model/variable.model';

function typedValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

/**
 * In `features/notes/` and not in `layout/`: a `{{field}}` is notes vocabulary. The
 * panel shows the page without knowing it, through [`SettingsRegistry`].
 *
 * These values are only a **suggestion**: what was typed on a note wins, and a field
 * left empty in the editor shows the variable in grey rather than copying it.
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

  /** Empty until something is typed: a new row is not a mistake. */
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
