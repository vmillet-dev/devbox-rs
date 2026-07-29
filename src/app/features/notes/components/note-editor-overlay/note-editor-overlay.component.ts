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
import { FALLBACK_LANGUAGE, LANGUAGE_LABELS, LanguageTag, isLanguageTag } from '@core/models/language.model';
import { Note, NoteLifecycle } from '@core/models/note.model';
import { PreferencesService } from '@core/preferences/preferences.service';
import { ClockService } from '@core/time/clock.service';
import { relativeTimeRef } from '@core/utils/relative-time.util';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { CodeViewerComponent } from '@shared/ui/code-viewer/code-viewer.component';
import { LifecycleBadgeComponent } from '@shared/ui/lifecycle-badge/lifecycle-badge.component';
import { TagPillComponent } from '@shared/ui/tag-pill/tag-pill.component';

/** Sans état : en recréer un à chaque recalcul serait inutile. */
const TEXT_ENCODER = new TextEncoder();

const FULLSCREEN_STORAGE_KEY = 'devbox.editorFullscreen';

/** Dérivées de la table des libellés pour ne pas la dupliquer. */
const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_LABELS).map(([value, label]) => ({
  value: value as LanguageTag,
  label,
}));

/**
 * `yyyy-MM-dd` d'un `<input type="date">` vers l'échéance correspondante.
 *
 * ⚠️ L'heure est portée à la **fin de la journée locale**, pas à minuit : une
 * note datée d'aujourd'hui serait sinon périmée au moment de la saisir. Et la
 * construction est explicite plutôt qu'un `new Date(value)`, qui interprète en
 * UTC — à l'ouest de Greenwich l'échéance reculerait d'un jour.
 */
function endOfLocalDay(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

/** Chemin inverse : ce que le champ doit afficher, dans le fuseau de l'utilisateur. */
function toDateInputValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Éditeur plein écran d'une note. Ne mute rien : il émet, `NotesStore` persiste.
 *
 * Il tient des **brouillons locaux** pour le titre et le corps — persister à
 * chaque frappe ferait un aller-retour IPC par caractère. Ils sont confirmés au
 * blur et, point délicat, avant chaque chemin de fermeture (croix, Échap, clic
 * sur le fond), aucun des trois ne produisant de `blur`.
 *
 * ⚠️ Ils sont réinitialisés sur l'**`id`** de la note et non sur la note :
 * chaque enregistrement rafraîchit `updatedAt` et produit un nouvel objet, qui
 * écraserait la saisie en cours.
 */
@Component({
  selector: 'app-note-editor-overlay',
  imports: [
    DialogBackdropDirective,
    TagPillComponent,
    LifecycleBadgeComponent,
    CodeViewerComponent,
    FocusTrapDirective,
    TranslocoPipe,
  ],
  templateUrl: './note-editor-overlay.component.html',
  styleUrl: './note-editor-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class NoteEditorOverlayComponent {
  private readonly clock = inject(ClockService);
  private readonly preferences = inject(PreferencesService);

  readonly note = input<Note | null>(null);

  readonly closed = output<void>();
  readonly titleChanged = output<string>();
  readonly contentChanged = output<string>();
  readonly languageChanged = output<LanguageTag>();
  readonly tagAdded = output<string>();
  readonly tagRemoved = output<string>();
  readonly pinToggled = output<void>();
  readonly lifecycleChanged = output<NoteLifecycle>();
  readonly deleteRequested = output<void>();

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

  /** Deux temps plutôt qu'un `confirm()` natif, qui bloque toute la WebView. */
  protected readonly confirmingDelete = linkedSignal({ source: this.noteId, computation: () => false });

  protected readonly tagInputValue = signal('');

  /**
   * Préférence d'affichage et non état de note : un `signal` simple, pas un
   * `linkedSignal` sur `noteId`, pour qu'elle survive au passage d'une note à
   * l'autre.
   */
  protected readonly fullscreen = signal(this.preferences.read(FULLSCREEN_STORAGE_KEY) === 'true');

  private readonly bodyEditor = viewChild<ElementRef<HTMLTextAreaElement>>('bodyEditor');

  protected readonly languageLabel = computed(
    () => LANGUAGE_LABELS[this.note()?.language ?? FALLBACK_LANGUAGE],
  );
  // Sur le brouillon : les stats suivent la frappe sans attendre la sauvegarde.
  protected readonly lineCount = computed(() => (this.note() ? this.draftContent().split('\n').length : 0));
  protected readonly byteSize = computed(() => TEXT_ENCODER.encode(this.draftContent()).length);
  protected readonly modifiedRef = computed(() => {
    const note = this.note();
    return note ? relativeTimeRef(note.updatedAt, this.clock.now()) : null;
  });

  /**
   * Vide pour une note permanente. C'est ce champ, et lui seul, qui alimente le
   * filtre « À trier » et l'indice « à trier bientôt » des sections.
   */
  protected readonly expiryInputValue = computed(() => {
    const lifecycle = this.note()?.lifecycle;
    return lifecycle?.kind === 'expires' ? toDateInputValue(lifecycle.at) : '';
  });

  protected toggleFullscreen(): void {
    const next = !this.fullscreen();
    this.fullscreen.set(next);
    this.preferences.write(FULLSCREEN_STORAGE_KEY, String(next));
  }

  /** N'émet que si le corps a réellement changé. */
  protected commitContent(): void {
    const note = this.note();
    if (note && this.draftContent() !== note.content) {
      this.contentChanged.emit(this.draftContent());
    }
  }

  protected commitTitle(): void {
    const note = this.note();
    if (note && this.draftTitle() !== note.title) {
      this.titleChanged.emit(this.draftTitle());
    }
  }

  /**
   * Un champ vidé rend la note permanente : c'est la façon naturelle de dire
   * « finalement, je la garde ». Une date illisible est ignorée plutôt que
   * transformée en `Invalid Date`, que le DTO rejetterait à la sérialisation.
   */
  protected onExpiryChange(value: string): void {
    if (!value) {
      this.lifecycleChanged.emit({ kind: 'permanent' });
      return;
    }

    const at = endOfLocalDay(value);
    if (at) {
      this.lifecycleChanged.emit({ kind: 'expires', at });
    }
  }

  protected onLanguageChange(value: string): void {
    // Le <select> ne propose que des langages connus ; la garde protège du cas
    // où la table des options et le type divergeraient.
    if (isLanguageTag(value)) {
      this.languageChanged.emit(value);
    }
  }

  protected submitTag(event: Event): void {
    event.preventDefault();
    const value = this.tagInputValue();
    this.tagInputValue.set('');
    if (value.trim()) {
      this.tagAdded.emit(value);
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
   * Échap quitte d'abord le corps, puis ferme la modale : sinon une frappe
   * destinée au champ referait disparaître l'éditeur entier. Le `blur` confirme
   * le brouillon au passage.
   */
  protected onEscape(): void {
    if (!this.note()) return;

    const editor = this.bodyEditor()?.nativeElement;
    if (editor && document.activeElement === editor) {
      editor.blur();
      return;
    }
    this.requestClose();
  }

  /** Seul chemin de fermeture : il confirme les brouillons avant de sortir. */
  protected requestClose(): void {
    this.commitTitle();
    this.commitContent();
    this.closed.emit();
  }
}
