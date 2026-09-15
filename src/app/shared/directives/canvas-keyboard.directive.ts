import { Directive, ElementRef, inject } from '@angular/core';
import { ShortcutGroup } from '@core/services/shortcuts/shortcut.model';
import { DialogStack } from '@shared/layout/dialog/dialog-stack';
import { Note } from '@core/model/note.model';
import { NoteCopyService } from '@core/state/note-copy.service';
import { NoteSelectionStore } from '@core/state/note-selection.store';
import { NotesQueryStore } from '@core/state/notes-query.store';
import { NotesStore } from '@core/state/notes.store';
import { CardBox, FocusDirection, nextFocusIndex } from '@core/utils/grid-navigation.util';

interface CanvasContext {
  readonly focused: Note | null;
  readonly notes: NotesStore;
  readonly canvas: NotesQueryStore;
  readonly selection: NoteSelectionStore;
  readonly copy: (content: string) => void;
  readonly move: (direction: FocusDirection) => void;
}

/**
 * ⚠️ The two used to be separate lists — a `ShortcutGroup` for the sheet and a `switch`
 * for the handler — and nothing kept them in step. Here documenting a key and binding
 * it are the same act.
 */
interface CanvasKey {
  readonly keys: readonly string[];
  readonly labelKey: string;
  /**
   * Absent means the key is only **documented** here and handled elsewhere — `Ctrl+K`
   * belongs to the search field.
   */
  readonly on?: readonly string[];
  /** Ctrl (or ⌘) must be held. Without it, no modifier may be. */
  readonly ctrl?: boolean;
  /** Answers whether it acted: only then is the browser's own behaviour cancelled. */
  readonly run?: (context: CanvasContext, key: string) => boolean;
}

const DIRECTIONS: Record<string, FocusDirection> = {
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Both answer whether they did anything, which is what decides the `preventDefault`. */
function given<T>(value: T | null | undefined, action: (value: T) => void): boolean {
  if (value === null || value === undefined) return false;

  action(value);
  return true;
}

function when(condition: boolean, action: () => void): boolean {
  if (!condition) return false;

  action();
  return true;
}

/**
 * In reading order, which is also the order the sheet lists them in. The letters are
 * deliberately bare: they only serve here, where no typing is in progress.
 */
const CANVAS_KEYS: readonly CanvasKey[] = [
  { keys: ['Ctrl', 'K'], labelKey: 'shortcuts.canvas.search' },
  {
    keys: ['↑ ↓ ← →'],
    labelKey: 'shortcuts.canvas.move',
    on: Object.keys(DIRECTIONS),
    run: ({ move }, key) => given(DIRECTIONS[key], move),
  },
  {
    keys: ['Enter'],
    labelKey: 'shortcuts.canvas.open',
    on: ['Enter'],
    run: ({ focused, notes }) => given(focused, (note) => notes.openNote(note.id)),
  },
  {
    keys: ['C'],
    labelKey: 'shortcuts.canvas.copy',
    on: ['c', 'C'],
    run: ({ focused, copy }) => given(focused, (note) => copy(note.content)),
  },
  {
    keys: ['P'],
    labelKey: 'shortcuts.canvas.pin',
    on: ['p', 'P'],
    run: ({ focused, notes }) => given(focused, (note) => void notes.togglePinned(note.id)),
  },
  {
    keys: ['X'],
    labelKey: 'shortcuts.canvas.check',
    on: ['x', 'X'],
    run: ({ focused, selection }) => given(focused, (note) => selection.toggleChecked(note.id)),
  },
  { keys: ['Ctrl'], labelKey: 'shortcuts.canvas.checkWithClick' },
  { keys: ['Shift'], labelKey: 'shortcuts.canvas.extendWithClick' },
  {
    keys: ['Delete'],
    labelKey: 'shortcuts.canvas.trash',
    on: ['Delete', 'Backspace'],
    run: ({ focused, notes }) => given(focused, (note) => void notes.deleteNote(note.id)),
  },
  {
    keys: ['Ctrl', 'Z'],
    labelKey: 'shortcuts.canvas.undo',
    on: ['z', 'Z'],
    ctrl: true,
    // Even after the banner is gone: it is the gesture one makes without looking.
    run: ({ notes }) => when(notes.lastDeletion() !== null, () => void notes.undoDeletion()),
  },
  {
    keys: ['Escape'],
    labelKey: 'shortcuts.canvas.clearSelection',
    on: ['Escape'],
    // Falls through: the selection first, then the filters. Both are states the canvas
    // is *in*, and Escape is the key for leaving one.
    run: ({ selection, canvas }) =>
      when(selection.hasSelection(), () => selection.clearSelection()) ||
      when(canvas.matched() !== null, () => canvas.clearFilters()),
  },
];

/** The sheet's canvas group, built from the table that binds the same keys. */
export const CANVAS_SHORTCUT_GROUP: ShortcutGroup = {
  id: 'notes.canvas',
  labelKey: 'shortcuts.groups.canvas',
  shortcuts: CANVAS_KEYS.map(({ keys, labelKey }) => ({ keys, labelKey })),
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Applied as a **host directives** of the notes page, so its element is the canvas
 * itself — which is how it measures the card grid without the page handing it a list
 * of sections. It acts only when no modal has the keyboard and no field has focus.
 */
@Directive({
  selector: '[appCanvasKeyboard]',
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class CanvasKeyboardDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly selection = inject(NoteSelectionStore);
  private readonly notes = inject(NotesStore);
  private readonly canvas = inject(NotesQueryStore);
  private readonly copier = inject(NoteCopyService);
  private readonly dialogs = inject(DialogStack);

  protected onKeydown(event: KeyboardEvent): void {
    if (this.dialogs.hasOpenDialog() || isTypingTarget(event.target)) return;

    const withCtrl = event.ctrlKey || event.metaKey;
    const entry = CANVAS_KEYS.find(
      (candidate) =>
        candidate.on?.includes(event.key) === true &&
        (candidate.ctrl ?? false) === withCtrl &&
        // A bare key stays bare: Alt is a different gesture entirely.
        (candidate.ctrl === true || !event.altKey),
    );
    if (!entry?.run) return;

    if (entry.run(this.context(), event.key)) {
      event.preventDefault();
    }
  }

  private context(): CanvasContext {
    return {
      focused: this.selection.focusedNote(),
      notes: this.notes,
      canvas: this.canvas,
      selection: this.selection,
      copy: (content) => void this.copier.copy(content),
      move: (direction) => this.moveFocus(direction),
    };
  }

  /**
   * The positions are **measured**: the column count depends on the window width, and
   * each section has its own number of cards.
   */
  private moveFocus(direction: FocusDirection): void {
    const boxes = this.cardBoxes();
    if (boxes.length === 0) return;

    const current = this.selection.focusedIndex();
    if (current < 0) {
      this.selection.focusIndex(0);
      return;
    }

    this.selection.focusIndex(nextFocusIndex(boxes, current, direction));
  }

  /** In DOM order, which is the order `visibleNotes` is in. */
  private cardBoxes(): readonly CardBox[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.card-shell')).map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, left: rect.left };
    });
  }
}
