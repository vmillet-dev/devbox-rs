import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FALLBACK_LANGUAGE, LANGUAGE_LABELS, LanguageTag, isLanguageTag } from '@core/model/language.model';
import { checklistProgress } from '@core/model/checklist.model';
import { Note, NotePatch } from '@core/model/note.model';
import { AttachmentsStore } from '@core/state/attachments.store';
import { PlaceholderFillStore } from '@core/state/placeholder-fill.store';
import { PreferencesService } from '@core/services/preferences/preferences.service';
import { ClockService } from '@core/services/time/clock.service';
import { relativeTimeRef } from '@core/services/time/relative-time.util';
import { DialogComponent } from '@shared/dialog/dialog.component';
import { CodeViewerComponent } from '@notes/ui/code-viewer/code-viewer.component';
import { AttachmentStripComponent } from './attachment-strip/attachment-strip.component';
import { ChecklistEditorComponent } from './checklist-editor/checklist-editor.component';
import { CopyButtonComponent } from '@notes/ui/copy-button/copy-button.component';
import { LifecycleBadgeComponent } from './lifecycle-badge/lifecycle-badge.component';
import { PlaceholderPanelComponent } from './placeholder-panel/placeholder-panel.component';
import { TagPillComponent } from '@notes/ui/tag-pill/tag-pill.component';

const TEXT_ENCODER = new TextEncoder();

const FULLSCREEN_STORAGE_KEY = 'devbox.editorFullscreen';

const FIELDS_PANEL_STORAGE_KEY = 'devbox.editorFieldsPanel';

const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_LABELS).map(([value, label]) => ({
  value: value as LanguageTag,
  label,
}));

/**
 * ⚠️ Carried to the **end of the local day**, not to midnight: a note dated today
 * would otherwise be expired the moment it is typed. Built explicitly rather than
 * with `new Date(value)`, which reads as UTC — west of Greenwich the deadline would
 * slip back a day.
 */
function endOfLocalDay(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function toDateInputValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Mutates nothing: it emits, `NotesStore` persists.
 *
 * It holds **local drafts** for the title and the body — persisting on every keystroke
 * would mean one IPC round trip per character. They are committed on blur and, the
 * delicate part, before every closing path, none of which produces a `blur`.
 *
 * ⚠️ They are keyed on the note's **`id`** and not on the note: every save refreshes
 * `updatedAt` and produces a new object, which would overwrite what is being typed.
 */
@Component({
  selector: 'app-note-editor-overlay',
  imports: [
    DialogComponent,
    AttachmentStripComponent,
    ChecklistEditorComponent,
    CopyButtonComponent,
    TagPillComponent,
    LifecycleBadgeComponent,
    PlaceholderPanelComponent,
    CodeViewerComponent,
    TranslocoPipe,
  ],
  templateUrl: './note-editor-overlay.component.html',
  styleUrl: './note-editor-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteEditorOverlayComponent {
  private readonly clock = inject(ClockService);
  private readonly preferences = inject(PreferencesService);

  /**
   * Attachments and `{{field}}` filling have a write cycle of their own, and the editor
   * reaches for them directly: routing seventeen bindings through the page made adding
   * one a four-file change.
   */
  protected readonly attachments = inject(AttachmentsStore);
  protected readonly fill = inject(PlaceholderFillStore);

  readonly note = input<Note | null>(null);

  readonly closed = output<void>();
  /**
   * One output rather than one per field: the page used to wire nine of them, so adding
   * a field meant editing four files. Whether a value actually moved is `NotesStore`'s
   * call — it is the one holding what is stored.
   */
  readonly patchRequested = output<NotePatch>();
  readonly deleteRequested = output<void>();
  /** Stays an output: `NotesStore` is the one that knows whether the note exists yet. */
  readonly placeholderValuesChanged = output<Record<string, string>>();

  protected readonly languageOptions = LANGUAGE_OPTIONS;

  private readonly noteId = computed(() => this.note()?.id ?? null);

  protected readonly draftTitle = linkedSignal({
    source: this.noteId,
    computation: () => untracked(() => this.note()?.title ?? ''),
  });

  protected readonly draftContent = linkedSignal({
    source: this.noteId,
    computation: () => untracked(() => this.note()?.content ?? ''),
  });

  protected readonly draftSource = linkedSignal({
    source: this.noteId,
    computation: () => untracked(() => this.note()?.source ?? ''),
  });

  /** Two steps rather than a native `confirm()`, which blocks the whole WebView. */
  protected readonly confirmingDelete = linkedSignal({ source: this.noteId, computation: () => false });

  protected readonly tagInputValue = signal('');

  /**
   * A display preference and not note state: a plain `signal`, so it survives moving
   * from one note to the next.
   */
  protected readonly fullscreen = signal(this.preferences.read(FULLSCREEN_STORAGE_KEY) === 'true');

  /**
   * Open by default: a panel folded away would hide the feature from anyone who does
   * not know it exists yet.
   */
  protected readonly fieldsPanelOpen = signal(this.preferences.read(FIELDS_PANEL_STORAGE_KEY) !== 'false');

  /** The preview belongs to the open note: it drops when moving to the next. */
  protected readonly previewingFilled = linkedSignal({
    source: this.noteId,
    computation: () => false,
  });

  private readonly bodyEditor = viewChild<ElementRef<HTMLTextAreaElement>>('bodyEditor');
  private readonly checklistEditor = viewChild(ChecklistEditorComponent);
  private readonly fieldsPanel = viewChild(PlaceholderPanelComponent);

  /** A todo list has no body: no coloured block, no format picker. */
  protected readonly isChecklist = computed(() => this.note()?.kind === 'checklist');
  protected readonly checklistStats = computed(() => checklistProgress(this.note()?.items ?? []));

  /**
   * The draft for an ordinary note — copying before leaving the field must yield what
   * is on screen — and the Markdown list for a todo list, which has no body.
   */
  protected readonly copyText = computed(() =>
    this.isChecklist() ? (this.note()?.copyText ?? '') : this.draftContent(),
  );

  protected readonly placeholders = computed(() => this.note()?.placeholders ?? []);
  protected readonly hasPlaceholders = computed(() => this.placeholders().length > 0);

  protected readonly showingPreview = computed(() => this.previewingFilled() && this.fill.preview() !== null);

  protected readonly languageLabel = computed(
    () => LANGUAGE_LABELS[this.note()?.language ?? FALLBACK_LANGUAGE],
  );
  protected readonly lineCount = computed(() => (this.note() ? this.draftContent().split('\n').length : 0));
  protected readonly byteSize = computed(() => TEXT_ENCODER.encode(this.draftContent()).length);
  protected readonly modifiedRef = computed(() => {
    const note = this.note();
    return note ? relativeTimeRef(note.updatedAt, this.clock.now()) : null;
  });

  /**
   * This field, and only this one, feeds the "untriaged" filter and the sections'
   * "due soon" hint.
   */
  protected readonly expiryInputValue = computed(() => {
    const lifecycle = this.note()?.lifecycle;
    return lifecycle?.kind === 'expires' ? toDateInputValue(lifecycle.at) : '';
  });

  /**
   * Folding the panel closes the preview: leaving the body read-only without the
   * button that put it there is a trap.
   */
  protected toggleFieldsPanel(): void {
    const next = !this.fieldsPanelOpen();
    this.fieldsPanelOpen.set(next);
    this.preferences.write(FIELDS_PANEL_STORAGE_KEY, String(next));

    if (!next) {
      this.previewingFilled.set(false);
    }
  }

  protected togglePreview(): void {
    const next = !this.previewingFilled();
    this.previewingFilled.set(next);

    if (next) {
      this.requestFillPreview();
    }
  }

  /**
   * The preview follows the typing, but nothing is written: the panel commits on
   * field exit.
   */
  protected onPlaceholderValuesChanged(): void {
    if (this.previewingFilled()) {
      this.requestFillPreview();
    }
  }

  /**
   * The body cannot move during the preview — the input is not there — so only the
   * values trigger a new request.
   */
  private requestFillPreview(): void {
    void this.fill.refreshPreview({
      content: this.draftContent(),
      values: this.placeholderValues(),
    });
  }

  /**
   * Composed at click time rather than kept up to date: a keystroke in the body or in
   * a field would make anything computed ahead of time stale.
   */
  protected requestFilledCopy(): void {
    void this.fill.copyFilled({
      content: this.draftContent(),
      values: this.placeholderValues(),
    });
  }

  private placeholderValues(): Record<string, string> {
    return this.fieldsPanel()?.values() ?? {};
  }

  protected toggleFullscreen(): void {
    const next = !this.fullscreen();
    this.fullscreen.set(next);
    this.preferences.write(FULLSCREEN_STORAGE_KEY, String(next));
  }

  /**
   * A **paste** is committed at once, typing stays deferred to blur: the paste is what
   * gives an empty note its language, and waiting for field exit would leave the badge
   * on TXT, which reads as "nothing was recognised".
   */
  protected onBodyInput(event: Event, value: string): void {
    this.draftContent.set(value);

    if ((event as InputEvent).inputType === 'insertFromPaste') {
      this.commitContent();
    }
  }

  /**
   * A pasted image becomes an **attachment**: the body is a `<textarea>` and can show
   * nothing but text. Only the content *type* is read here — the bytes are re-read
   * natively, where the clipboard hands them over already decoded.
   */
  protected onPaste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data || data.types.includes('text/plain')) return;

    const hasImage =
      data.types.some((type) => type.startsWith('image/')) ||
      [...data.files].some((file) => file.type.startsWith('image/'));
    if (!hasImage) return;

    event.preventDefault();
    void this.attachments.addPastedImage();
  }

  protected requestPatch(patch: NotePatch): void {
    if (this.note()) {
      this.patchRequested.emit(patch);
    }
  }

  protected commitContent(): void {
    this.requestPatch({ content: this.draftContent() });
  }

  protected commitTitle(): void {
    this.requestPatch({ title: this.draftTitle() });
  }

  protected commitSource(): void {
    this.requestPatch({ source: this.draftSource() });
  }

  protected togglePin(): void {
    const note = this.note();
    if (note) {
      this.requestPatch({ pinned: !note.pinned });
    }
  }

  protected removeTag(tag: string): void {
    const note = this.note();
    if (note) {
      this.requestPatch({ tags: note.tags.filter((existing) => existing !== tag) });
    }
  }

  /**
   * Clearing the field makes the note permanent. An unreadable date is ignored rather
   * than turned into an `Invalid Date`, which the DTO would reject.
   */
  protected onExpiryChange(value: string): void {
    if (!value) {
      this.requestPatch({ lifecycle: { kind: 'permanent' } });
      return;
    }

    const at = endOfLocalDay(value);
    if (at) {
      this.requestPatch({ lifecycle: { kind: 'expires', at } });
    }
  }

  protected onLanguageChange(value: string): void {
    // The guard covers the option table and the type drifting apart.
    if (isLanguageTag(value)) {
      this.requestPatch({ language: value });
    }
  }

  protected submitTag(event: Event): void {
    event.preventDefault();
    const value = this.tagInputValue();
    this.tagInputValue.set('');

    const note = this.note();
    if (note && value.trim()) {
      this.requestPatch({ tags: [...note.tags, value] });
    }
  }

  protected onDeleteClick(): void {
    if (this.confirmingDelete()) {
      this.deleteRequested.emit();
      return;
    }
    this.confirmingDelete.set(true);
  }

  /**
   * Escape leaves the body first, then closes the modal: otherwise a keystroke meant
   * for the field would make the whole editor disappear. The `blur` commits the draft
   * on the way, and a backdrop click reaches the same path.
   */
  protected onDismiss(): void {
    const editor = this.bodyEditor()?.nativeElement;
    if (editor && document.activeElement === editor) {
      editor.blur();
      return;
    }
    this.requestClose();
  }

  /**
   * ⚠️ The only closing path, and it commits the drafts first: Escape, the backdrop and
   * the close button produce no `blur`, so the last line typed would be lost — which is
   * why the checklist commits here too.
   */
  protected requestClose(): void {
    this.commitTitle();
    this.commitSource();
    this.commitContent();
    this.checklistEditor()?.commit();
    this.fieldsPanel()?.commit();
    this.closed.emit();
  }
}
