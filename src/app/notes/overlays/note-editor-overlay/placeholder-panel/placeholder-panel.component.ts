import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  untracked,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Placeholder } from '@core/model/note.model';
import { CopyButtonComponent } from '@notes/ui/copy-button/copy-button.component';
import {
  PlaceholderFieldsComponent,
  PlaceholderValue,
} from '@notes/ui/placeholder-fields/placeholder-fields.component';

const SUMMARY_LIMIT = 2;

function storedValues(placeholders: readonly Placeholder[]): Record<string, string> {
  return Object.fromEntries(placeholders.map((placeholder) => [placeholder.name, placeholder.value]));
}

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((name) => (a[name] ?? '') === (b[name] ?? ''));
}

/**
 * Unfolded it is the form; folded it fits on one line that **summarises what it hides**
 * — a bare counter read as a section heading nobody thinks to click. Nothing shows for a
 * note with no field: a header always present and always empty is a box nobody ticks.
 *
 * It holds a **local draft** of the values, committed on field exit and re-seeded on the
 * note's **id**, never on the note, whose identity changes on every save.
 *
 * Mutates nothing and fills nothing: it emits, `NotesStore` persists.
 */
@Component({
  selector: 'app-placeholder-panel',
  imports: [CopyButtonComponent, PlaceholderFieldsComponent, TranslocoPipe],
  templateUrl: './placeholder-panel.component.html',
  styleUrl: './placeholder-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPanelComponent {
  readonly placeholders = input.required<readonly Placeholder[]>();

  /**
   * ⚠️ The editor **session**, not the note's id. Materialising a draft changes that id
   * for the same note, and a draft keyed on it was replayed from a note the store had
   * only just created — losing whatever had been typed into it a moment earlier, with no
   * later update able to bring it back, since only a change of source replays it.
   */
  readonly session = input.required<number>();

  /** A display preference, held by the editor: it outlives the note. */
  readonly open = input(true);

  readonly previewing = input(false);

  readonly rawContent = input('');

  readonly toggled = output<void>();
  readonly previewToggled = output<void>();
  /** On every keystroke: what the preview follows. Writes nothing. */
  readonly valuesChanged = output<Record<string, string>>();
  /** On field exit: what the note stores. */
  readonly valuesCommitted = output<Record<string, string>>();

  private readonly draft = linkedSignal({
    source: this.session,
    computation: () => untracked(() => storedValues(this.placeholders())),
  });

  readonly values = this.draft.asReadonly();

  /**
   * Compared against the draft rather than the values received: between the commit and
   * the back end's answer the open note still carries the old ones.
   */
  private readonly committed = linkedSignal({
    source: this.session,
    computation: () => untracked(() => storedValues(this.placeholders())),
  });

  protected readonly total = computed(() => this.placeholders().length);
  protected readonly filled = computed(
    () => this.placeholders().filter((placeholder) => this.draft()[placeholder.name]).length,
  );

  private readonly summary = computed(() =>
    this.placeholders()
      .map((placeholder) => ({ name: placeholder.name, value: this.draft()[placeholder.name] ?? '' }))
      .filter((entry) => entry.value !== ''),
  );

  /** Two is enough: beyond that the bar would overflow instead of informing. */
  protected readonly visibleSummary = computed(() => this.summary().slice(0, SUMMARY_LIMIT));
  protected readonly hiddenSummary = computed(() => Math.max(0, this.summary().length - SUMMARY_LIMIT));

  protected onChanged({ name, value }: PlaceholderValue): void {
    this.draft.update((current) => ({ ...current, [name]: value }));
    this.valuesChanged.emit(this.draft());
  }

  /** Clears every field, handing back to the defaults written in the text. */
  protected reset(): void {
    this.draft.set({});
    this.valuesChanged.emit(this.draft());
    this.commit();
  }

  /**
   * Called on a field's exit **and** by the editor before it closes: neither Escape, the
   * backdrop nor the close button produces a `blur`. Sends only the fields the text
   * carries today — a value whose token has left the content has no box to show in.
   */
  commit(): void {
    const values = Object.fromEntries(
      this.placeholders().map((placeholder) => [placeholder.name, this.draft()[placeholder.name] ?? '']),
    );

    if (sameValues(values, this.committed())) return;

    this.committed.set(values);
    this.valuesCommitted.emit(values);
  }
}
