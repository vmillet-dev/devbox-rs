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
import { Placeholder } from '@features/notes/model/note.model';
import { CopyButtonComponent } from '../copy-button/copy-button.component';
import {
  PlaceholderFieldsComponent,
  PlaceholderValue,
} from '../placeholder-fields/placeholder-fields.component';

/** How many values the folded bar names before counting the rest. */
const SUMMARY_LIMIT = 2;

/** The values as the note carries them: where typing starts from. */
function storedValues(placeholders: readonly Placeholder[]): Record<string, string> {
  return Object.fromEntries(placeholders.map((placeholder) => [placeholder.name, placeholder.value]));
}

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((name) => (a[name] ?? '') === (b[name] ?? ''));
}

/**
 * The open note's `{{fields}}`, filled in place.
 *
 * Unfolded it is the form; folded it fits on one line that **summarises what it
 * hides** — `host = db.internal`, and a count of the rest. A summary reads as
 * something to open, where a bare counter read as a section heading nobody
 * thinks to click. The whole strip is the button.
 *
 * Nothing shows for a note with no field — the editor does not mount it —
 * because a header always present and always empty is a box nobody ticks.
 *
 * It holds a **local draft** of the values, like the body and the title:
 * committed on field exit, not on every keystroke. The draft is re-seeded on
 * the note's **id**, never on the note, whose identity changes on every save.
 *
 * Mutates nothing and fills nothing: it emits, `NotesStore` persists and the
 * back end substitutes.
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

  /** The draft's source: see the warning above the class. */
  readonly noteId = input.required<string>();

  /** A display preference, held by the editor: it outlives the note. */
  readonly open = input(true);

  /** The preview belongs to the editor — it replaces its body. */
  readonly previewing = input(false);

  /** The note's text as is, for a copy without filling. */
  readonly rawContent = input('');

  readonly toggled = output<void>();
  readonly previewToggled = output<void>();
  /** On every keystroke: what the preview follows. Writes nothing. */
  readonly valuesChanged = output<Record<string, string>>();
  /** On field exit: what the note stores. */
  readonly valuesCommitted = output<Record<string, string>>();

  private readonly draft = linkedSignal({
    source: this.noteId,
    computation: () => untracked(() => storedValues(this.placeholders())),
  });

  /** What the panel shows right now — the editor fills with it. */
  readonly values = this.draft.asReadonly();

  /**
   * What is taken to be stored. Compared against the draft rather than the
   * values received: between the commit and the back end's answer the open note
   * still carries the old ones, and every field change would rewrite.
   */
  private readonly committed = linkedSignal({
    source: this.noteId,
    computation: () => untracked(() => storedValues(this.placeholders())),
  });

  protected readonly total = computed(() => this.placeholders().length);
  protected readonly filled = computed(
    () => this.placeholders().filter((placeholder) => this.draft()[placeholder.name]).length,
  );

  /** What the folded bar shows of its content, so "what will I copy with?" needs no click. */
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

  /**
   * Clears every field, handing back to the defaults written in the text.
   * Committed at once — it is a gesture, not typing.
   */
  protected reset(): void {
    this.draft.set({});
    this.valuesChanged.emit(this.draft());
    this.commit();
  }

  /**
   * Commits what was typed. Called on a field's exit **and** by the editor
   * before it closes: neither Escape, the backdrop nor the close button
   * produces a `blur`.
   *
   * Sends only the fields the text carries today: a value whose token has left
   * the content has no box to show in any more.
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
