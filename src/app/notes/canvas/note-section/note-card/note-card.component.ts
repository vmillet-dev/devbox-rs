import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { checklistProgress, noteCopyText } from '@core/model/checklist.model';
import { Note } from '@core/model/note.model';
import { NoteSelectionStore } from '@core/state/note-selection.store';
import { NotesStore } from '@core/state/notes.store';
import { PlaceholderFillStore } from '@core/state/placeholder-fill.store';
import { SpacesStore } from '@core/state/spaces.store';
import { TranslationRef } from '@core/services/i18n/translation-ref.model';
import { ClockService } from '@core/services/time/clock.service';
import { expiryRef, relativeTimeRef } from '@core/utils/relative-time.util';
import { CodeViewerComponent } from '@notes/ui/code-viewer/code-viewer.component';
import { LanguageBadgeComponent } from '@notes/ui/language-badge/language-badge.component';
import { CopyButtonComponent } from '@notes/ui/copy-button/copy-button.component';
import { NoteCardMenuComponent } from './note-card-menu/note-card-menu.component';

/** The footer label is either plain text (a source name) or a translation reference (a time). */
type FooterLabel = { kind: 'text'; value: string } | { kind: 'ref'; ref: TranslationRef };

/** An opening request, and how: the modifier decides the selection. */
export interface NoteActivation {
  readonly noteId: string;
  readonly toggleChecked: boolean;
  readonly extendRange: boolean;
}

/** What fits under a head that no longer spends a row on the language badge. */
const SNIPPET_LINES = 4;
const MAX_VISIBLE_TAGS = 2;
/** What fits between the progress bar and the footer on a 150 px card. */
const MAX_VISIBLE_ITEMS = 2;

@Component({
  selector: 'app-note-card',
  imports: [
    CodeViewerComponent,
    CopyButtonComponent,
    LanguageBadgeComponent,
    NoteCardMenuComponent,
    TranslocoPipe,
  ],
  templateUrl: './note-card.component.html',
  styleUrl: './note-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteCardComponent {
  private readonly clock = inject(ClockService);
  private readonly notes = inject(NotesStore);
  private readonly selection = inject(NoteSelectionStore);
  private readonly fill = inject(PlaceholderFillStore);

  /** Read by the card menu, which removes the note's own space from the destinations. */
  protected readonly spaces = inject(SpacesStore);

  readonly note = input.required<Note>();

  /**
   * Only the click stays an output: which of opening, ticking and extending a range it
   * means is the canvas's to arbitrate, and the card does not know the visible list.
   */
  readonly opened = output<NoteActivation>();

  protected readonly selected = computed(() => this.notes.selectedNoteId() === this.note().id);
  /** The note keyboard navigation points at — distinct from the selection. */
  protected readonly focused = computed(() => this.selection.focusedNoteId() === this.note().id);
  protected readonly checked = computed(() => this.selection.checkedIds().has(this.note().id));

  private readonly cardButton = viewChild.required<ElementRef<HTMLButtonElement>>('cardButton');

  constructor() {
    // Real focus follows the state, or arrow navigation would move an outline without
    // taking the keyboard with it.
    effect(() => {
      if (this.focused() && document.activeElement !== this.cardButton().nativeElement) {
        this.cardButton().nativeElement.focus({ preventScroll: false });
      }
    });
  }

  /**
   * What the card shows in place of a body when a search put it here: the line that
   * actually matched.
   *
   * ⚠️ The back end decides, as everywhere else — `null` outside a search **and** for a
   * note found by its own title, which the card already shows in full. Without it the
   * preview was the first three lines of the body, so a note matched at line forty came
   * back with nothing explaining why it was in the list.
   */
  protected readonly searchHit = computed(() => this.note().searchHit);

  protected readonly snippet = computed(() => {
    const hit = this.searchHit();
    if (hit) return hit.excerpt;

    return this.note().content.split('\n').slice(0, SNIPPET_LINES).join('\n');
  });

  /**
   * A body excerpt is still code and stays coloured; a tag or a checklist item is not,
   * and the highlighter would paint its words as keywords.
   */
  protected readonly snippetIsCode = computed(() => {
    const hit = this.searchHit();
    return !hit || hit.field === 'body';
  });

  /**
   * Where a short list has to start for the thing a search found to be in it.
   *
   * ⚠️ A **window**, not a filter: the list keeps its order and its length, so what the
   * reader sees is the card scrolled to the right place rather than a different card.
   */
  private windowStart(length: number, at: number, size: number): number {
    if (at < size) return 0;
    return Math.min(at, Math.max(0, length - size));
  }

  /**
   * ⚠️ The excerpt is clipped at 160 characters, so an item found by a long line comes
   * back with a trailing `…` and never equals its own text. Compared by prefix.
   */
  private indexOfHit(texts: readonly string[], excerpt: string): number {
    const needle = excerpt.endsWith('…') ? excerpt.slice(0, -1) : excerpt;
    return texts.findIndex((text) => text.startsWith(needle));
  }

  private readonly tagWindowStart = computed(() => {
    const hit = this.searchHit();
    if (hit?.field !== 'tag') return 0;

    const tags = this.note().tags;
    return this.windowStart(tags.length, this.indexOfHit(tags, hit.excerpt), MAX_VISIBLE_TAGS);
  });

  protected readonly displayedTags = computed(() => {
    const from = this.tagWindowStart();
    return this.note().tags.slice(from, from + MAX_VISIBLE_TAGS);
  });

  protected readonly isChecklist = computed(() => this.note().kind === 'checklist');
  protected readonly progress = computed(() => checklistProgress(this.note().items));
  /**
   * A todo list has no body, so `searchHit` never reached its card: the branch that
   * renders the excerpt is unreachable behind `isChecklist()`. A list found by its fifth
   * item showed its first two and `+3 more`, explaining nothing.
   *
   * ⚠️ Replacing the layer with the excerpt was not an option: these are real checkboxes
   * a card can be ticked from. The window slides to the matching item instead, and the
   * boxes keep working.
   */
  private readonly itemWindowStart = computed(() => {
    const hit = this.searchHit();
    if (hit?.field !== 'item') return 0;

    const items = this.note().items;
    const texts = items.map((item) => item.text);
    return this.windowStart(items.length, this.indexOfHit(texts, hit.excerpt), MAX_VISIBLE_ITEMS);
  });

  protected readonly visibleItems = computed(() => {
    const from = this.itemWindowStart();
    return this.note().items.slice(from, from + MAX_VISIBLE_ITEMS);
  });
  protected readonly hiddenItemCount = computed(() =>
    Math.max(0, this.note().items.length - MAX_VISIBLE_ITEMS),
  );

  /** The body for a snippet, the list rendered as Markdown for a todo list. */
  protected readonly copyText = computed(() => noteCopyText(this.note()));

  protected readonly hasPlaceholders = computed(() => this.note().placeholders.length > 0);

  /**
   * The back end has already decided **what** to show. The two dated variants are
   * formatted here so the label ages on screen without a new query.
   */
  protected readonly footerLabel = computed<FooterLabel>(() => {
    const footer = this.note().footer;
    if (footer.kind === 'source') {
      return { kind: 'text', value: footer.value };
    }
    if (footer.kind === 'expiry') {
      return { kind: 'ref', ref: expiryRef(footer.at, this.clock.now()) };
    }
    return { kind: 'ref', ref: relativeTimeRef(footer.at, this.clock.now()) };
  });

  /**
   * Ctrl ticks, Shift extends the range, a bare click opens — the convention of a file
   * list, which is what the canvas became once it gained a selection.
   */
  protected onOpen(event: MouseEvent): void {
    this.opened.emit({
      noteId: this.note().id,
      toggleChecked: event.ctrlKey || event.metaKey,
      extendRange: event.shiftKey,
    });
  }

  /** The checkbox is a control of its own: it must not open the note. */
  protected onCheck(event: MouseEvent): void {
    event.stopPropagation();
    this.selection.toggleChecked(this.note().id);
  }

  /**
   * Ticking from the card without opening the note: the whole list is written back.
   *
   * ⚠️ The template counts within the **window**, and the position in the note is what
   * gets written. They were the same number while the window always started at zero;
   * now that a search slides it, ticking the first visible box would have ticked the
   * first box of the list instead — a card silently editing the wrong line.
   */
  protected onItemToggle(event: MouseEvent, indexInWindow: number): void {
    event.stopPropagation();
    const index = this.itemWindowStart() + indexInWindow;

    void this.notes.setChecklist(
      this.note().id,
      this.note().items.map((item, at) => (at === index ? { ...item, done: !item.done } : { ...item })),
    );
  }

  protected onFill(event: MouseEvent): void {
    event.stopPropagation();
    this.fill.openFor(this.note().id);
  }

  /** The menu does not know the note: the card attaches the id. */
  protected onMove(spaceId: string): void {
    void this.notes.moveNote(this.note().id, spaceId);
  }

  protected onDelete(): void {
    void this.notes.deleteNote(this.note().id);
  }
}
