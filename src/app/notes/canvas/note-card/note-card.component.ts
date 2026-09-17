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

type FooterLabel = { kind: 'text'; value: string } | { kind: 'ref'; ref: TranslationRef };

export interface NoteActivation {
  readonly noteId: string;
  readonly toggleChecked: boolean;
  readonly extendRange: boolean;
}

const SNIPPET_LINES = 4;
const MAX_VISIBLE_TAGS = 2;
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

  protected readonly spaces = inject(SpacesStore);

  readonly note = input.required<Note>();

  /** Which of opening, ticking and extending it means is the canvas's to arbitrate. */
  readonly opened = output<NoteActivation>();

  protected readonly selected = computed(() => this.notes.selectedNoteId() === this.note().id);
  /** The note keyboard navigation points at — distinct from the selection. */
  protected readonly focused = computed(() => this.selection.focusedNoteId() === this.note().id);
  protected readonly checked = computed(() => this.selection.checkedIds().has(this.note().id));

  private readonly cardButton = viewChild.required<ElementRef<HTMLButtonElement>>('cardButton');

  constructor() {
    // Real focus follows the state, or arrow navigation moves an outline without
    // taking the keyboard with it.
    effect(() => {
      if (this.focused() && document.activeElement !== this.cardButton().nativeElement) {
        this.cardButton().nativeElement.focus({ preventScroll: false });
      }
    });
  }

  protected readonly searchHit = computed(() => this.note().searchHit);

  protected readonly snippet = computed(() => {
    const hit = this.searchHit();
    if (hit) return hit.excerpt;

    return this.note().content.split('\n').slice(0, SNIPPET_LINES).join('\n');
  });

  /** A tag or an item is not code: the highlighter would paint its words as keywords. */
  protected readonly snippetIsCode = computed(() => {
    const hit = this.searchHit();
    return !hit || hit.field === 'body';
  });

  /**
   * Where a short list has to start for the thing a search found to be in it. ⚠️ A
   * window, not a filter: the list keeps its order and its length.
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
   * The excerpt cannot replace the layer: these are real checkboxes a card can be
   * ticked from. The window slides to the matching item instead.
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

  protected readonly copyText = computed(() => noteCopyText(this.note()));

  protected readonly hasPlaceholders = computed(() => this.note().placeholders.length > 0);

  /** Without either, a todo list has no band to draw and the title starts at the top. */
  protected readonly hasMarks = computed(() => this.hasPlaceholders() || this.note().attachmentCount > 0);

  /** The back end decides what to show; the dated variants are formatted here so they age. */
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

  protected onOpen(event: MouseEvent): void {
    this.opened.emit({
      noteId: this.note().id,
      toggleChecked: event.ctrlKey || event.metaKey,
      extendRange: event.shiftKey,
    });
  }

  protected onCheck(event: MouseEvent): void {
    event.stopPropagation();
    this.selection.toggleChecked(this.note().id);
  }

  /**
   * ⚠️ The template counts within the window; the position in the note is what gets
   * written. A search slides the window, so the two are not the same number.
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

  protected onMove(spaceId: string): void {
    void this.notes.moveNote(this.note().id, spaceId);
  }

  protected onDelete(): void {
    void this.notes.deleteNote(this.note().id);
  }
}
