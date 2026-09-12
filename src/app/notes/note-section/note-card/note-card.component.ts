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
import { checklistProgress, noteCopyText } from '@features/notes/model/checklist.model';
import { Note } from '@features/notes/model/note.model';
import { NoteSelectionStore } from '@features/notes/state/note-selection.store';
import { NotesStore } from '@features/notes/state/notes.store';
import { PlaceholderFillStore } from '@features/notes/state/placeholder-fill.store';
import { SpacesStore } from '@features/notes/state/spaces.store';
import { TranslationRef } from '@core/i18n/translation-ref.model';
import { ClockService } from '@core/time/clock.service';
import { expiryRef, relativeTimeRef } from '@core/time/relative-time.util';
import { CodeViewerComponent } from '@shared/ui/code-viewer/code-viewer.component';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';
import { CopyButtonComponent } from '../copy-button/copy-button.component';
import { NoteCardMenuComponent } from '../note-card-menu/note-card-menu.component';

/** The footer label is either plain text (a source name) or a translation reference (a time). */
type FooterLabel = { kind: 'text'; value: string } | { kind: 'ref'; ref: TranslationRef };

/** An opening request, and how: the modifier decides the selection. */
export interface NoteActivation {
  readonly noteId: string;
  readonly toggleChecked: boolean;
  readonly extendRange: boolean;
}

const SNIPPET_LINES = 3;
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

  protected readonly snippet = computed(() =>
    this.note().content.split('\n').slice(0, SNIPPET_LINES).join('\n'),
  );

  protected readonly displayedTags = computed(() => this.note().tags.slice(0, MAX_VISIBLE_TAGS));

  protected readonly isChecklist = computed(() => this.note().kind === 'checklist');
  protected readonly progress = computed(() => checklistProgress(this.note().items));
  protected readonly visibleItems = computed(() => this.note().items.slice(0, MAX_VISIBLE_ITEMS));
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

  /** Ticking from the card without opening the note: the whole list is written back. */
  protected onItemToggle(event: MouseEvent, index: number): void {
    event.stopPropagation();
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
