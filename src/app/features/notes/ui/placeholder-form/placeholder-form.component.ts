import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogComponent } from '@shared/ui/dialog/dialog.component';
import { Placeholder } from '@features/notes/model/note.model';
import {
  PlaceholderFieldsComponent,
  PlaceholderValue,
} from '../placeholder-fields/placeholder-fields.component';

/**
 * Seeded with the values **already stored** on the note: there is one set per note, and
 * what comes out is copied *and* kept. The values leave raw — `notes::placeholder::fill`
 * decides what an empty field is worth and what is not a field at all.
 *
 * "Copy as is" exists for the note that contains template code without being a snippet.
 */
@Component({
  selector: 'app-placeholder-form',
  imports: [DialogComponent, PlaceholderFieldsComponent, TranslocoPipe],
  templateUrl: './placeholder-form.component.html',
  styleUrl: './placeholder-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderFormComponent {
  readonly placeholders = input.required<readonly Placeholder[]>();

  readonly submitted = output<Record<string, string>>();
  readonly rawRequested = output<void>();
  readonly cancelled = output<void>();

  /**
   * `null` until something is typed: the note then supplies its own values, and copying
   * them here would freeze them.
   */
  private readonly typed = signal<Record<string, string> | null>(null);

  protected readonly count = computed(() => this.placeholders().length);

  protected readonly values = computed(
    () =>
      this.typed() ??
      Object.fromEntries(this.placeholders().map((placeholder) => [placeholder.name, placeholder.value])),
  );

  protected setValue({ name, value }: PlaceholderValue): void {
    this.typed.set({ ...this.values(), [name]: value });
  }

  protected submit(event: Event): void {
    event.preventDefault();

    const filled: Record<string, string> = {};
    for (const placeholder of this.placeholders()) {
      filled[placeholder.name] = this.values()[placeholder.name] ?? '';
    }
    this.submitted.emit(filled);
  }
}
