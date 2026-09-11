import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppEventsService } from '@core/ipc/app-events.service';
import { AppMenuEntry, AppMenuRegistry } from '@core/menu/app-menu.registry';
import { ClipboardService } from '@core/clipboard/clipboard.service';
import { ClockService } from '@core/time/clock.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FileDropService } from '@core/window/file-drop.service';
import { StatusNotifier } from '@core/notifications/status.service';
import { Note } from './model/note.model';
import { AttachmentsStore } from './state/attachments.store';
import { LibraryStore } from './state/library.store';
import { NotesStore } from './state/notes.store';
import { PaletteStore } from './state/palette.store';
import { SpacesStore } from './state/spaces.store';
import { TagsStore } from './state/tags.store';
import { TrashStore } from './state/trash.store';
import { FilterChipsComponent } from './ui/filter-chips/filter-chips.component';
import { CardBox, FocusDirection, nextFocusIndex } from './ui/grid-navigation.util';
import { LanguageRailComponent } from './ui/language-rail/language-rail.component';
import { NewNoteButtonComponent } from './ui/new-note-button/new-note-button.component';
import { NoteActivation } from './ui/note-card/note-card.component';
import {
  FillRequest,
  NoteEditorOverlayComponent,
} from './ui/note-editor-overlay/note-editor-overlay.component';
import { NoteSectionComponent } from './ui/note-section/note-section.component';
import { PlaceholderFormComponent } from './ui/placeholder-form/placeholder-form.component';
import { ImageLightboxComponent } from './ui/image-lightbox/image-lightbox.component';
import { QuickPaletteComponent } from './ui/quick-palette/quick-palette.component';
import { SearchBoxComponent } from './ui/search-box/search-box.component';
import { SelectionBarComponent } from './ui/selection-bar/selection-bar.component';
import {
  SpaceDeletion,
  SpaceRenaming,
  SpaceSwitcherComponent,
} from './ui/space-switcher/space-switcher.component';
import { TagManagerComponent } from './ui/tag-manager/tag-manager.component';
import { TagRailComponent } from './ui/tag-rail/tag-rail.component';
import { TrashPanelComponent } from './ui/trash-panel/trash-panel.component';
import { UndoBarComponent } from './ui/undo-bar/undo-bar.component';

/** Flèches et lettres du canevas, quand le focus n'est pas dans un champ. */
const DIRECTIONS: Record<string, FocusDirection> = {
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Une frappe destinée à un champ de saisie n'appartient pas au canevas. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Seule page de la feature : elle branche les stores sur les composants
 * d'affichage. Les enfants restent purement dérivés de leurs entrées.
 *
 * C'est aussi elle qui arbitre entre stores qui ne se connaissent pas — la
 * corbeille, les tags et la bibliothèque écrivent des notes sans pouvoir
 * recharger le canevas, faute de quoi il y aurait un cycle d'injection — et elle
 * qui **inscrit les entrées du menu « Fichier »** : la barre de titre ne connaît
 * aucune feature.
 */
@Component({
  selector: 'app-notes-page',
  imports: [
    SpaceSwitcherComponent,
    SearchBoxComponent,
    FilterChipsComponent,
    NewNoteButtonComponent,
    SelectionBarComponent,
    TagRailComponent,
    LanguageRailComponent,
    NoteSectionComponent,
    NoteEditorOverlayComponent,
    QuickPaletteComponent,
    ImageLightboxComponent,
    PlaceholderFormComponent,
    TrashPanelComponent,
    TagManagerComponent,
    UndoBarComponent,
    TranslocoPipe,
  ],
  templateUrl: './notes-page.component.html',
  styleUrl: './notes-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class NotesPageComponent {
  protected readonly store = inject(NotesStore);
  protected readonly spaces = inject(SpacesStore);
  protected readonly palette = inject(PaletteStore);
  protected readonly trash = inject(TrashStore);
  protected readonly tags = inject(TagsStore);
  protected readonly library = inject(LibraryStore);
  protected readonly attachments = inject(AttachmentsStore);

  private readonly clipboard = inject(ClipboardService);
  private readonly clock = inject(ClockService);
  private readonly notifier = inject(ErrorNotifier);
  private readonly status = inject(StatusNotifier);
  private readonly menu = inject(AppMenuRegistry);

  /** Aperçu affiché en grand par-dessus l'éditeur. */
  protected readonly imageZoomed = signal(false);

  /** Note dont on remplit les `{{champs}}` avant copie, hors palette. */
  protected readonly fillTarget = signal<Note | null>(null);

  /** Corps rempli que l'aperçu de l'éditeur affiche ; `null` avant la première demande. */
  protected readonly filledPreview = signal<string | null>(null);

  /**
   * Dernière demande d'aperçu partie. Le remplissage traverse le pont, et deux
   * réponses peuvent revenir dans le désordre : seule celle de la demande
   * courante a le droit de s'afficher.
   */
  private latestPreviewRequest: FillRequest | null = null;

  private readonly sectionElements = viewChildren(NoteSectionComponent, { read: ElementRef });

  /**
   * Une modale ouverte capte le clavier : ni le raccourci de recherche ni la
   * navigation du canevas ne doivent agir derrière elle.
   */
  protected readonly canvasHasFocus = computed(
    () =>
      this.store.selectedNote() === null &&
      !this.palette.isOpen() &&
      !this.trash.isOpen() &&
      !this.tags.isOpen() &&
      this.fillTarget() === null,
  );

  protected readonly searchShortcutEnabled = this.canvasHasFocus;

  /**
   * Les raccourcis globaux sont enregistrés côté Rust, qui se contente de
   * montrer la fenêtre et de prévenir : la création reste ici, et passe donc par
   * le même `create_note` que n'importe quelle autre note.
   */
  constructor() {
    const events = inject(AppEventsService);
    const drops = inject(FileDropService);
    const destroyRef = inject(DestroyRef);

    destroyRef.onDestroy(events.on('devbox:capture', () => void this.store.captureFromClipboard()));
    destroyRef.onDestroy(events.on('devbox:new-note', () => this.store.createNote()));
    destroyRef.onDestroy(events.on('devbox:palette', () => void this.palette.open()));

    // Le glisser-déposer est un événement de fenêtre : c'est ici qu'on décide
    // ce qu'il vise, et il ne vise quelque chose que si l'éditeur est ouvert.
    destroyRef.onDestroy(drops.on((paths) => void this.onFilesDropped(paths)));

    this.registerMenuEntries(destroyRef);

    // Les pièces jointes suivent la note **persistée** : un brouillon n'existe
    // pas encore en base, et rien n'y est attachable.
    effect(() => void this.attachments.openFor(this.store.persistedNoteId()));

    // Un aperçu appartient à la note qui l'a demandé. Le garder en ouvrant la
    // suivante afficherait le corps rempli de la précédente, le temps d'un
    // aller-retour — et la réponse en vol n'a plus rien à dire.
    effect(() => {
      this.store.selectedNoteId();
      this.latestPreviewRequest = null;
      this.filledPreview.set(null);
    });
  }

  // --- Menu « Fichier » ------------------------------------------------------

  /**
   * La barre de titre affiche ce que les features inscrivent. `disabled` est un
   * signal : « Exporter la sélection » suit ce qui est coché à l'instant.
   */
  private registerMenuEntries(destroyRef: DestroyRef): void {
    const nothingChecked = computed(() => !this.store.hasSelection());

    const entries: AppMenuEntry[] = [
      { id: 'notes.import', labelKey: 'file.import', order: 10, run: () => void this.onImport() },
      {
        id: 'notes.exportAll',
        labelKey: 'file.exportAll',
        order: 20,
        run: () => void this.library.export(null, this.clock.now()),
      },
      {
        id: 'notes.exportSpace',
        labelKey: 'file.exportSpace',
        order: 30,
        disabled: computed(() => this.spaces.activeSpaceId() === null),
        run: () => void this.library.export(this.spaces.activeSpaceId(), this.clock.now()),
      },
      {
        id: 'notes.exportSelection',
        labelKey: 'file.exportSelection',
        order: 40,
        disabled: nothingChecked,
        run: () => void this.library.exportSelection(this.checkedIds(), this.clock.now()),
      },
      {
        id: 'notes.copyMarkdown',
        labelKey: 'file.copyMarkdown',
        order: 50,
        disabled: nothingChecked,
        run: () => void this.library.copyAsMarkdown(this.checkedIds()),
      },
    ];

    this.menu.register(entries);
    destroyRef.onDestroy(() => this.menu.unregister(entries.map((entry) => entry.id)));
  }

  private checkedIds(): readonly string[] {
    return this.store.checkedNotes().map((note) => note.id);
  }

  private async onImport(): Promise<void> {
    if (await this.library.import()) {
      this.spaces.reload();
      this.store.reload();
    }
  }

  // --- Espaces ---------------------------------------------------------------

  protected onSpaceRenamed({ id, name }: SpaceRenaming): void {
    // Rien à recharger : une note ne porte que le `spaceId`, jamais le nom.
    void this.spaces.renameSpace(id, name);
  }

  /**
   * `SpacesStore` ne connaît pas `NotesStore` — l'injecter serait un cycle. Le
   * rechargement est donc enchaîné ici : les notes de l'espace supprimé ont
   * changé de `spaceId` côté base, et rien ne le signalerait autrement quand la
   * requête courante ne dépend pas de l'espace disparu.
   */
  protected async onSpaceDeleted({ id, targetSpaceId }: SpaceDeletion): Promise<void> {
    if (await this.spaces.deleteSpace(id, targetSpaceId)) {
      this.store.reload();
    }
  }

  // --- Ouverture et sélection ------------------------------------------------

  protected onNoteActivated({ noteId, toggleChecked, extendRange }: NoteActivation): void {
    if (extendRange) {
      this.store.checkRangeTo(noteId);
      return;
    }
    if (toggleChecked) {
      this.store.toggleChecked(noteId);
      this.store.focusNote(noteId);
      return;
    }
    this.store.openNote(noteId);
  }

  protected onCopySelection(): void {
    void this.library.copyAsMarkdown(this.checkedIds());
  }

  // --- Corbeille et tags -----------------------------------------------------

  protected async onRestore(id: string): Promise<void> {
    if (await this.trash.restore(id)) {
      this.store.reload();
    }
  }

  protected onCloseTrash(): void {
    this.trash.close();
    this.store.reload();
  }

  protected async onRenameTag(into: string): Promise<void> {
    if (await this.tags.renameSelected(into)) {
      this.store.reload();
    }
  }

  protected async onDeleteTags(): Promise<void> {
    if (await this.tags.deleteSelected()) {
      this.store.reload();
    }
  }

  // --- Pièces jointes --------------------------------------------------------

  /**
   * Joindre exige une note **en base** : le brouillon est donc enregistré au
   * passage. Une note à laquelle on attache un fichier n'est plus vide.
   *
   * Le magasin de pièces jointes est rebranché **ici**, sans attendre l'effet
   * qui suit `persistedNoteId` : celui-ci ne s'exécute qu'au prochain cycle de
   * détection, soit après l'écriture qui suit — qui, sans note courante,
   * n'attacherait rien et ne le dirait pas. `openFor` est idempotent, le
   * rebranchement est donc sans effet quand la note existait déjà.
   */
  private async noteToAttachTo(): Promise<string | null> {
    const noteId = await this.store.materialiseDraft();
    if (noteId) {
      await this.attachments.openFor(noteId);
    }

    return noteId;
  }

  protected async onAttachRequested(): Promise<void> {
    if (await this.noteToAttachTo()) {
      await this.attachments.attach();
    }
  }

  protected async onImagePasted(): Promise<void> {
    if (!(await this.noteToAttachTo())) return;

    if (!(await this.attachments.attachClipboardImage(this.clock.now()))) {
      this.notifier.notify({ ref: { key: 'attachments.pasteEmpty' } });
    }
  }

  protected async onSaveAttachment(id: string): Promise<void> {
    const path = await this.attachments.saveAs(id);
    if (path) {
      this.status.notify({ key: 'attachments.saved', params: { path } });
    }
  }

  /**
   * Refermer l'aperçu ferme aussi la vue agrandie : elle affiche les octets que
   * l'aperçu a chargés, et les garder à l'écran sans lui n'aurait pas de sens.
   */
  protected onTogglePreview(id: string): void {
    this.imageZoomed.set(false);
    void this.attachments.togglePreview(id);
  }

  /** Un dépôt ne vise quelque chose que si une note est ouverte pour le recevoir. */
  private async onFilesDropped(paths: readonly string[]): Promise<void> {
    if (this.store.selectedNote() === null || paths.length === 0) return;
    if (!(await this.noteToAttachTo())) return;

    for (const path of paths) {
      await this.attachments.attachPath(path);
    }
  }

  // --- Champs `{{…}}` --------------------------------------------------------

  protected onFillRequested(noteId: string): void {
    this.fillTarget.set(this.store.visibleNotes().find((note) => note.id === noteId) ?? null);
  }

  /**
   * Remplit puis copie : le remplissage est une règle du back, pas d'ici.
   *
   * Les valeurs sont **gardées** au passage. Il n'y a qu'un jeu de valeurs par
   * note : celui du panneau de l'éditeur, celui de la carte et celui de la
   * palette sont le même, sinon remplir deux fois de suite au même endroit
   * demanderait deux fois la même chose.
   */
  protected async onFillSubmitted(values: Record<string, string>): Promise<void> {
    const note = this.fillTarget();
    if (!note) return;

    this.fillTarget.set(null);
    await this.copy(await this.store.fillPlaceholders(note.content, values));
    await this.store.setPlaceholderValues(note.id, values);
  }

  /** L'aperçu de l'éditeur : la page remplit, l'éditeur affiche. */
  protected async onFillPreviewRequested(request: FillRequest): Promise<void> {
    this.latestPreviewRequest = request;
    const filled = await this.store.fillPlaceholders(request.content, request.values);

    if (this.latestPreviewRequest === request) {
      this.filledPreview.set(filled);
    }
  }

  /**
   * Copie depuis l'éditeur. L'accusé passe par le bandeau d'état plutôt que par
   * la coche du bouton : le texte n'existe qu'une fois le pont traversé, et
   * cocher avant d'avoir la réponse annoncerait une copie qui n'a pas eu lieu.
   */
  protected async onFilledCopyRequested(request: FillRequest): Promise<void> {
    const filled = await this.store.fillPlaceholders(request.content, request.values);

    if (await this.copy(filled)) {
      this.status.notify({ key: 'placeholders.copiedFilled' });
    }
  }

  protected async onFillRaw(): Promise<void> {
    const note = this.fillTarget();
    this.fillTarget.set(null);
    if (note) {
      await this.copy(note.content);
    }
  }

  // --- Palette ---------------------------------------------------------------

  protected async onPaletteFill(values: Record<string, string>): Promise<void> {
    const note = this.palette.pendingFill();
    if (!note) return;

    await this.palette.copyAndDismiss(await this.store.fillPlaceholders(note.content, values));
    // Gardées comme ailleurs : la palette remplit la même note que l'éditeur.
    await this.store.setPlaceholderValues(note.id, values);
  }

  protected onPaletteOpen(noteId: string): void {
    this.palette.close();
    this.store.openNote(noteId);
  }

  /**
   * La palette capture autant qu'elle retrouve : sur sa ligne de création, ce
   * qui a été tapé devient le contenu d'une note, enregistrée et ouverte.
   *
   * `PaletteStore` ne crée pas lui-même — il ne connaît pas `NotesStore`, et
   * l'inverse serait un cycle.
   */
  protected async onPaletteChosen(): Promise<void> {
    const content = this.palette.takeNewNoteContent();
    if (content !== null) {
      await this.store.createWithContent(content);
      return;
    }

    await this.palette.chooseHighlighted();
  }

  // --- Navigation au clavier -------------------------------------------------

  /**
   * Le canevas se pilote au clavier quand le focus n'est ni dans un champ ni
   * derrière une modale. Les touches sont volontairement des lettres nues :
   * elles ne servent qu'ici, où aucune saisie n'est en cours.
   */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.canvasHasFocus() || isTypingTarget(event.target)) return;

    // `Ctrl+Z` reprend la dernière suppression, même après la disparition du
    // bandeau : c'est le geste qu'on fait sans regarder l'écran.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      if (this.store.lastDeletion()) {
        event.preventDefault();
        void this.store.undoDeletion();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const direction = DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      this.moveFocus(direction);
      return;
    }

    const focused = this.focusedNote();

    switch (event.key) {
      case 'Enter':
        if (focused) {
          event.preventDefault();
          this.store.openNote(focused.id);
        }
        break;
      case 'x':
      case 'X':
        if (focused) {
          event.preventDefault();
          this.store.toggleChecked(focused.id);
        }
        break;
      case 'c':
      case 'C':
        if (focused) {
          event.preventDefault();
          void this.copy(focused.content);
        }
        break;
      case 'p':
      case 'P':
        if (focused) {
          event.preventDefault();
          void this.store.togglePinned(focused.id);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (focused) {
          event.preventDefault();
          void this.store.deleteNote(focused.id);
        }
        break;
      case 'Escape':
        if (this.store.hasSelection()) {
          event.preventDefault();
          this.store.clearSelection();
        }
        break;
    }
  }

  private focusedNote(): Note | null {
    const index = this.store.focusedIndex();
    return index < 0 ? null : (this.store.visibleNotes()[index] ?? null);
  }

  /**
   * Les positions sont **mesurées** : le nombre de colonnes dépend de la largeur
   * de la fenêtre, et chaque section a son propre nombre de cartes. Sans focus
   * courant, le premier déplacement entre par la première carte.
   */
  private moveFocus(direction: FocusDirection): void {
    const boxes = this.cardBoxes();
    if (boxes.length === 0) return;

    const current = this.store.focusedIndex();
    if (current < 0) {
      this.store.focusIndex(0);
      return;
    }

    this.store.focusIndex(nextFocusIndex(boxes, current, direction));
  }

  private cardBoxes(): readonly CardBox[] {
    return this.sectionElements()
      .flatMap((section) =>
        Array.from((section.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.card-shell')),
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, left: rect.left };
      });
  }

  /** Rend ce que le presse-papier a réellement accepté : un accusé se mérite. */
  private async copy(content: string): Promise<boolean> {
    if (await this.clipboard.copy(content)) return true;

    this.notifier.notify({ ref: { key: 'errors.copyFailed' } });
    return false;
  }
}
