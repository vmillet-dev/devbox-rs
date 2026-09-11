import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogComponent } from '@shared/ui/dialog/dialog.component';
import { Placeholder } from '@features/notes/model/note.model';
import {
  PlaceholderFieldsComponent,
  PlaceholderValue,
} from '../placeholder-fields/placeholder-fields.component';

/**
 * Typing a snippet's `{{fields}}` before copying, from a card or the palette —
 * where there is no open editor to carry the panel.
 *
 * Seeded with the values **already stored** on the note: there is one set per
 * note, and the form offers them rather than asking again. What comes out is
 * copied *and* kept.
 *
 * The values leave raw: `notes::placeholder::fill` decides what an empty field
 * is worth and what is not a field at all. Making that choice here would be
 * making it twice.
 *
 * "Copy as is" exists for the note that contains template code without being
 * one — the back end is careful, not infallible.
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
   * What is being typed. `null` until something is: the note then supplies its
   * own values, and copying them here would freeze them the day the form opens
   * on a note whose values changed in between.
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
