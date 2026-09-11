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
import {
  FALLBACK_LANGUAGE,
  LANGUAGE_LABELS,
  LanguageTag,
  isLanguageTag,
} from '@core/language/language.model';
import { checklistProgress, checklistToText } from '@features/notes/model/checklist.model';
import { Attachment, ChecklistItem, Note, NoteLifecycle } from '@features/notes/model/note.model';
import { PreferencesService } from '@core/preferences/preferences.service';
import { ClockService } from '@core/time/clock.service';
import { relativeTimeRef } from '@core/time/relative-time.util';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { CodeViewerComponent } from '@shared/ui/code-viewer/code-viewer.component';
import { AttachmentStripComponent } from '../attachment-strip/attachment-strip.component';
import { ChecklistEditorComponent } from '../checklist-editor/checklist-editor.component';
import { CopyButtonComponent } from '../copy-button/copy-button.component';
import { LifecycleBadgeComponent } from '../lifecycle-badge/lifecycle-badge.component';
import { PlaceholderPanelComponent } from '../placeholder-panel/placeholder-panel.component';
import { TagPillComponent } from '@shared/ui/tag-pill/tag-pill.component';

/** Sans état : en recréer un à chaque recalcul serait inutile. */
const TEXT_ENCODER = new TextEncoder();

const FULLSCREEN_STORAGE_KEY = 'devbox.editorFullscreen';

const FIELDS_PANEL_STORAGE_KEY = 'devbox.editorFieldsPanel';

/** Dérivées de la table des libellés pour ne pas la dupliquer. */
const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_LABELS).map(([value, label]) => ({
  value: value as LanguageTag,
  label,
}));

/**
 * Une demande de remplissage : le texte et les valeurs à y poser.
 *
 * L'éditeur ne remplit pas lui-même — c'est `notes::placeholder::fill`, côté
 * Rust, qui décide ce qu'un champ vaut. Il dit donc *quoi* remplir, et la page
 * lui rend le résultat.
 */
export interface FillRequest {
  readonly content: string;
  readonly values: Record<string, string>;
}

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
    AttachmentStripComponent,
    ChecklistEditorComponent,
    CopyButtonComponent,
    TagPillComponent,
    LifecycleBadgeComponent,
    PlaceholderPanelComponent,
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

  /**
   * Les pièces jointes viennent d'un store à part et ne descendent pas de la
   * note : elles ont leur propre cycle d'écriture, et les faire transiter par
   * `Note` obligerait à recharger la note entière à chaque ajout.
   */
  readonly attachments = input<readonly Attachment[]>([]);
  readonly attachmentsBusy = input(false);
  readonly attachmentPreviewId = input<string | null>(null);
  readonly attachmentPreviewData = input<string | null>(null);
  /** Vue agrandie ouverte par-dessus : elle capte Échap avant l'éditeur. */
  readonly imageZoomed = input(false);

  /**
   * Le corps une fois ses `{{champs}}` remplis, tel que la page l'a obtenu du
   * back. `null` tant que rien n'a été demandé : l'aperçu n'affiche alors rien
   * plutôt qu'un texte encore truffé de jetons.
   */
  readonly filledContent = input<string | null>(null);

  readonly closed = output<void>();
  readonly titleChanged = output<string>();
  readonly contentChanged = output<string>();
  readonly sourceChanged = output<string>();
  readonly languageChanged = output<LanguageTag>();
  readonly tagAdded = output<string>();
  readonly tagRemoved = output<string>();
  readonly pinToggled = output<void>();
  readonly lifecycleChanged = output<NoteLifecycle>();
  readonly checklistChanged = output<readonly ChecklistItem[]>();
  readonly deleteRequested = output<void>();
  readonly attachmentAddRequested = output<void>();
  readonly attachmentRemoveRequested = output<string>();
  readonly attachmentPreviewToggled = output<string>();
  readonly attachmentOpenRequested = output<string>();
  readonly attachmentSaveRequested = output<string>();
  /** L'aperçu a été cliqué : la page ouvre la vue agrandie, au-dessus d'ici. */
  readonly imageZoomRequested = output<void>();
  /** Valeurs des `{{champs}}` à enregistrer sur la note. */
  readonly placeholderValuesChanged = output<Record<string, string>>();
  /** Ce que l'aperçu doit montrer : la page remplit et redescend le texte. */
  readonly fillPreviewRequested = output<FillRequest>();
  /** Copier le corps rempli — c'est ce que « Copier » veut dire ici. */
  readonly filledCopyRequested = output<FillRequest>();
  /** Une image a été collée dans le corps : la page la joint à la note. */
  readonly imagePasted = output<void>();

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

  /** Deux temps plutôt qu'un `confirm()` natif, qui bloque toute la WebView. */
  protected readonly confirmingDelete = linkedSignal({ source: this.noteId, computation: () => false });

  protected readonly tagInputValue = signal('');

  /**
   * Préférence d'affichage et non état de note : un `signal` simple, pas un
   * `linkedSignal` sur `noteId`, pour qu'elle survive au passage d'une note à
   * l'autre.
   */
  protected readonly fullscreen = signal(this.preferences.read(FULLSCREEN_STORAGE_KEY) === 'true');

  /**
   * Même nature que `fullscreen` : une préférence d'affichage, ouverte par
   * défaut. Un panneau replié d'office cacherait la fonction à qui ne sait pas
   * encore qu'elle existe.
   */
  protected readonly fieldsPanelOpen = signal(this.preferences.read(FIELDS_PANEL_STORAGE_KEY) !== 'false');

  /** L'aperçu est propre à la note ouverte : il retombe en passant à la suivante. */
  protected readonly previewingFilled = linkedSignal({
    source: this.noteId,
    computation: () => false,
  });

  private readonly bodyEditor = viewChild<ElementRef<HTMLTextAreaElement>>('bodyEditor');
  private readonly checklistEditor = viewChild(ChecklistEditorComponent);
  private readonly fieldsPanel = viewChild(PlaceholderPanelComponent);

  /** Une todolist n'a pas de corps : ni bloc coloré, ni sélecteur de format. */
  protected readonly isChecklist = computed(() => this.note()?.kind === 'checklist');
  protected readonly checklistStats = computed(() => checklistProgress(this.note()?.items ?? []));

  /**
   * Ce que le bouton de copie pose dans le presse-papier. Le brouillon pour une
   * note ordinaire — copier avant d'avoir quitté le champ doit rendre ce qu'on
   * voit —, la liste rendue en Markdown pour une todolist, qui n'a pas de corps.
   */
  protected readonly copyText = computed(() =>
    this.isChecklist() ? checklistToText(this.note()?.items ?? []) : this.draftContent(),
  );

  /**
   * Une todolist n'a pas de corps, donc pas de jeton : `placeholders` est vide
   * et le panneau n'est jamais monté — inutile de traiter le cas à part.
   */
  protected readonly placeholders = computed(() => this.note()?.placeholders ?? []);
  protected readonly hasPlaceholders = computed(() => this.placeholders().length > 0);

  /** Ce que l'aperçu montre : le corps rempli, en lecture seule. */
  protected readonly showingPreview = computed(
    () => this.previewingFilled() && this.filledContent() !== null,
  );

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

  /**
   * Replier le panneau referme l'aperçu : la bascule vit dedans, et laisser le
   * corps en lecture seule sans le bouton qui l'y a mis serait un piège.
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
   * Une valeur a changé. L'aperçu suit la frappe — c'est ce qu'on lui demande —
   * mais rien n'est écrit : le panneau confirme à la sortie du champ.
   */
  protected onPlaceholderValuesChanged(): void {
    if (this.previewingFilled()) {
      this.requestFillPreview();
    }
  }

  /**
   * Le corps ne peut pas bouger pendant l'aperçu — le champ de saisie n'est pas
   * là — donc seules les valeurs déclenchent une nouvelle demande.
   */
  private requestFillPreview(): void {
    this.fillPreviewRequested.emit({
      content: this.draftContent(),
      values: this.placeholderValues(),
    });
  }

  /**
   * Copie le corps **rempli**. Le texte est composé au moment du clic, et non
   * tenu à jour en permanence : une frappe dans le corps ou dans un champ
   * rendrait périmé tout ce qui aurait été calculé d'avance.
   */
  protected requestFilledCopy(): void {
    this.filledCopyRequested.emit({
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
   * Un **collage** est confirmé tout de suite, la frappe reste différée au blur.
   *
   * C'est le collage qui donne son langage à une note vide (`domain::detect`),
   * et le langage n'est connu qu'une fois le contenu persisté : attendre la
   * sortie du champ laisserait le badge sur TXT, ce qui se lit comme « rien n'a
   * été reconnu ». Une frappe, elle, ne justifie toujours pas un aller-retour
   * IPC par caractère.
   */
  protected onBodyInput(event: Event, value: string): void {
    this.draftContent.set(value);

    if ((event as InputEvent).inputType === 'insertFromPaste') {
      this.commitContent();
    }
  }

  /**
   * Une image collée devient une **pièce jointe** : le corps est un `<textarea>`,
   * il ne peut rien afficher d'autre que du texte, et y laisser tomber le
   * collage ne ferait rien du tout.
   *
   * Seul le *type* du contenu est lu ici — les octets sont relus côté natif, où
   * le presse-papier système les rend déjà décodés. Un collage qui porte du
   * texte reste traité nativement par le champ.
   */
  protected onPaste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data || data.types.includes('text/plain')) return;

    const hasImage =
      data.types.some((type) => type.startsWith('image/')) ||
      [...data.files].some((file) => file.type.startsWith('image/'));
    if (!hasImage) return;

    event.preventDefault();
    this.imagePasted.emit();
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

  protected commitSource(): void {
    const note = this.note();
    if (note && this.draftSource() !== note.source) {
      this.sourceChanged.emit(this.draftSource());
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
    // La vue agrandie est ouverte **par-dessus** l'éditeur : elle est la
    // première à devoir se refermer, et les deux écoutent le même document.
    if (!this.note() || this.imageZoomed()) return;

    const editor = this.bodyEditor()?.nativeElement;
    if (editor && document.activeElement === editor) {
      editor.blur();
      return;
    }
    this.requestClose();
  }

  /**
   * Seul chemin de fermeture : il confirme les brouillons avant de sortir.
   *
   * La liste de tâches est confirmée de la même façon et pour la même raison :
   * Échap, le fond et le bouton de fermeture ne produisent aucun `blur`, la
   * dernière ligne tapée serait sinon perdue.
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
