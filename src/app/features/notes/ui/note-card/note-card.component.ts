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
import { ChecklistItem, checklistProgress, noteCopyText } from '@features/notes/model/checklist.model';
import { Note } from '@features/notes/model/note.model';
import { Space } from '@features/notes/model/space.model';
import { TranslationRef } from '@core/i18n/translation-ref.model';
import { ClockService } from '@core/time/clock.service';
import { expiryRef, relativeTimeRef } from '@core/time/relative-time.util';
import { CodeViewerComponent } from '@shared/ui/code-viewer/code-viewer.component';
import { LanguageBadgeComponent } from '@shared/ui/language-badge/language-badge.component';
import { CopyButtonComponent } from '../copy-button/copy-button.component';
import { NoteCardMenuComponent } from '../note-card-menu/note-card-menu.component';

/** The footer label is either plain text (a source name) or a translation reference (a time). */
type FooterLabel = { kind: 'text'; value: string } | { kind: 'ref'; ref: TranslationRef };

/** A move requested from a card's menu. */
export interface NoteMove {
  readonly noteId: string;
  readonly spaceId: string;
}

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

/** A box ticked on a card: the note, and the list as it becomes. */
export interface ItemToggle {
  readonly noteId: string;
  readonly items: readonly ChecklistItem[];
}

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

  readonly note = input.required<Note>();
  /** The note open in the editor. */
  readonly selected = input(false);
  /** The note keyboard navigation points at — distinct from the selection. */
  readonly focused = input(false);
  readonly checked = input(false);
  /** Destinations the menu offers; the note's own space is removed from them. */
  readonly spaces = input<readonly Space[]>([]);

  readonly opened = output<NoteActivation>();
  readonly checkToggled = output<string>();
  readonly moveRequested = output<NoteMove>();
  readonly deleteRequested = output<string>();
  /** The note carries `{{fields}}`: the page opens the input form. */
  readonly fillRequested = output<string>();
  /** A box ticked from the canvas, without going through the editor. */
  readonly itemToggled = output<ItemToggle>();

  private readonly cardButton = viewChild.required<ElementRef<HTMLButtonElement>>('cardButton');

  constructor() {
    // Real focus follows the state, otherwise arrow navigation would move an
    // outline without taking the keyboard with it.
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
   * The back end has already decided **what** to show; only the rendering is
   * left. The two dated variants are formatted here so the label ages on screen
   * without a new query.
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
   * Ctrl ticks, Shift extends the range, a bare click opens — the convention of
   * a file list, which is what the canvas became once it gained a selection.
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
    this.checkToggled.emit(this.note().id);
  }

  /**
   * Ticking from the card without opening the note — the real gesture of a todo
   * list, crossed off as one goes.
   *
   * The card emits the **whole** list as it becomes: it persists nothing itself.
   */
  protected onItemToggle(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.itemToggled.emit({
      noteId: this.note().id,
      items: this.note().items.map((item, at) =>
        at === index ? { ...item, done: !item.done } : { ...item },
      ),
    });
  }

  protected onFill(event: MouseEvent): void {
    event.stopPropagation();
    this.fillRequested.emit(this.note().id);
  }

  /** The menu does not know the note: the card attaches the id. */
  protected onMove(spaceId: string): void {
    this.moveRequested.emit({ noteId: this.note().id, spaceId });
  }

  protected onDelete(): void {
    this.deleteRequested.emit(this.note().id);
  }
}
