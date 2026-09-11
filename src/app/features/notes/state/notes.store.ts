import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  inject,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { NotesRepository } from '../data/notes.repository';
import { ClipboardService } from '@core/clipboard/clipboard.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FALLBACK_LANGUAGE, LanguageTag } from '@core/language/language.model';
import {
  ChecklistItem,
  Note,
  NoteDraft,
  NoteFilter,
  NoteKind,
  NoteLifecycle,
  NotePatch,
  NoteSection,
  NotesQuery,
  NotesView,
} from '../model/note.model';
import { ClockService } from '@core/time/clock.service';
import { SpacesStore } from './spaces.store';

export type { NoteFilter, NoteKind } from '../model/note.model';

/** La recherche traverse le pont IPC : un appel par caractère serait gâché. */
export const SEARCH_DEBOUNCE_MS = 150;

/**
 * Durée pendant laquelle l'annulation reste proposée. Passé ce délai la note
 * n'est pas perdue pour autant — elle est en corbeille pour 30 jours.
 */
export const UNDO_WINDOW_MS = 8000;

/** Ce qu'une annulation a besoin de reprendre. */
export interface Deletion {
  readonly ids: readonly string[];
  readonly count: number;
}

/**
 * Identifiant de la note en cours de création, **jamais persisté**.
 *
 * Ouvrir la création n'écrit rien : une note vide par ouverture ferait un
 * canevas de déchets à ranger. Le brouillon vit dans le store jusqu'à la
 * première saisie qui vaut la peine d'être gardée.
 */
export const DRAFT_ID = '__draft__';

/**
 * Ce qui distingue une note qu'on abandonne d'une note qu'on enregistre. Un tag
 * ou une échéance suffisent : la note n'est plus vide, même sans texte.
 *
 * Un item aussi : une todolist n'a pas de corps, sans cette clause une liste
 * remplie mais sans titre resterait locale et disparaîtrait à la fermeture.
 */
function isWorthSaving(note: Note): boolean {
  return (
    note.title.trim() !== '' ||
    note.content.trim() !== '' ||
    note.source.trim() !== '' ||
    note.tags.length > 0 ||
    note.items.length > 0 ||
    note.pinned ||
    note.lifecycle.kind === 'expires'
  );
}

/**
 * Champs d'une note neuve.
 *
 * Titre et source vides : l'UI affiche des libellés de remplacement traduits,
 * et stocker « Nouvelle note » en dur figerait du français dans les données.
 * `txt` vaut « rien choisi » — c'est ce que `create_note` remplace par une
 * détection sur le contenu.
 */
function emptyDraft(spaceId: string, kind: NoteKind): NoteDraft {
  return {
    spaceId,
    title: '',
    language: FALLBACK_LANGUAGE,
    content: '',
    source: '',
    tags: [],
    pinned: false,
    lifecycle: { kind: 'permanent' },
    kind,
    items: [],
  };
}

/**
 * Le brouillon vu comme une `Note`, pour que l'éditeur n'ait pas à connaître
 * deux formes. Les champs dérivés portent des valeurs neutres : ils viennent du
 * back, qui n'a encore rien vu de cette note.
 */
function emptyNote(spaceId: string, now: Date, kind: NoteKind): Note {
  return {
    ...emptyDraft(spaceId, kind),
    id: DRAFT_ID,
    createdAt: now,
    updatedAt: now,
    footer: { kind: 'age', at: now },
    expiringSoon: false,
    placeholders: [],
    attachmentCount: 0,
  };
}

/** Ce qu'on envoie à `create_note` : le brouillon sans ses champs dérivés. */
function toDraftPayload(note: Note): NoteDraft {
  return {
    spaceId: note.spaceId,
    title: note.title,
    language: note.language,
    content: note.content,
    source: note.source,
    tags: [...note.tags],
    pinned: note.pinned,
    lifecycle: note.lifecycle,
    kind: note.kind,
    items: note.items.map((item) => ({ ...item })),
  };
}

function sameItems(a: readonly ChecklistItem[], b: readonly ChecklistItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => item.text === b[index].text && item.done === b[index].done)
  );
}

/** Journée **locale** : on ne re-interroge qu'au changement de jour. */
function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

interface QueryParams {
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  readonly languages: readonly LanguageTag[];
  readonly day: string;
}

function sameFacets(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Par **valeur** : `Date` se compare par identité, donc rejouer la même échéance
 * déclencherait une écriture à chaque passage dans le champ date.
 */
function sameLifecycle(a: NoteLifecycle, b: NoteLifecycle): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'expires' || a.at.getTime() === (b as { at: Date }).at.getTime();
}

/** Un ensemble neuf, jamais muté. */
function toggled<T>(selection: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(selection);
  if (!next.delete(value)) {
    next.add(value);
  }
  return next;
}

/**
 * ⚠️ `resource` compare ses paramètres par identité : sans ce comparateur, le
 * littéral neuf que produit `queryParams` à chaque battement d'horloge
 * relancerait une requête toutes les 30 s, masquée par le cache de vue.
 */
function sameQueryParams(a: QueryParams, b: QueryParams): boolean {
  return (
    a.spaceId === b.spaceId &&
    a.search === b.search &&
    a.filter === b.filter &&
    a.day === b.day &&
    sameFacets(a.tags, b.tags) &&
    sameFacets(a.languages, b.languages)
  );
}

/**
 * État des notes. Ne filtre pas, ne trie pas, ne regroupe pas : décrit ce que
 * l'utilisateur demande et affiche la **vue** que le backend renvoie.
 *
 * Deux principes : les signaux inscriptibles restent privés (toute mutation
 * passe par une méthode), et **le backend fait autorité** — on persiste puis on
 * recharge, donc rien à annuler en cas d'échec.
 */
@Injectable({ providedIn: 'root' })
export class NotesStore {
  private readonly repository = inject(NotesRepository);
  private readonly clipboard = inject(ClipboardService);
  private readonly clock = inject(ClockService);
  private readonly notifier = inject(ErrorNotifier);
  private readonly spaces = inject(SpacesStore);

  private readonly _searchQuery = signal('');
  private readonly _debouncedSearch = signal('');
  private readonly _activeFilter = signal<NoteFilter>('all');
  private readonly _selectedTags = signal<ReadonlySet<string>>(new Set());
  private readonly _selectedLanguages = signal<ReadonlySet<LanguageTag>>(new Set());
  private readonly _selectedNote = signal<Note | null>(null);
  private readonly _draftNote = signal<Note | null>(null);
  private readonly _checkedIds = signal<ReadonlySet<string>>(new Set());
  private readonly _focusedNoteId = signal<string | null>(null);
  private readonly _lastDeletion = signal<Deletion | null>(null);
  private readonly _undoVisible = signal(false);

  /** Reflète la frappe sans attendre : c'est la valeur affichée dans le champ. */
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();
  readonly selectedTags = this._selectedTags.asReadonly();
  readonly selectedLanguages = this._selectedLanguages.asReadonly();
  /** Le brouillon prime : tant qu'il existe, c'est lui que l'éditeur affiche. */
  readonly selectedNote = computed<Note | null>(() => this._draftNote() ?? this._selectedNote());
  readonly selectedNoteId = computed<string | null>(() => this.selectedNote()?.id ?? null);

  /**
   * Identifiant réellement en base, ou `null` tant que la note ouverte n'est
   * qu'un brouillon. Ce que doit lire tout ce qui a besoin d'une note existante
   * — les pièces jointes, par exemple.
   */
  readonly persistedNoteId = computed<string | null>(() => this._selectedNote()?.id ?? null);
  readonly focusedNoteId = this._focusedNoteId.asReadonly();
  readonly checkedIds = this._checkedIds.asReadonly();
  readonly lastDeletion = this._lastDeletion.asReadonly();

  /** Ce que le bandeau affiche : la même suppression, tant qu'elle est proposée. */
  readonly undoBanner = computed<Deletion | null>(() => (this._undoVisible() ? this._lastDeletion() : null));

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private undoTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Identifiant réel pris par le brouillon une fois enregistré.
   *
   * ⚠️ Indispensable : la fermeture de l'éditeur confirme le titre **puis** le
   * contenu sans détection de changement entre les deux, donc le second appel
   * porte encore `DRAFT_ID` alors que la note existe déjà. Sans cette
   * redirection, il irait écrire dans le vide.
   */
  private draftMaterialisedAs: string | null = null;

  /**
   * Critères déclenchant une requête. L'instant exact n'en fait pas partie :
   * seule la **journée** compte pour le découpage en sections. Le comparateur
   * `equal` est indispensable, voir `sameQueryParams`.
   */
  private readonly queryParams = computed<QueryParams>(
    () => ({
      spaceId: this.spaces.activeSpaceId(),
      search: this._debouncedSearch().trim(),
      filter: this._activeFilter(),
      tags: [...this._selectedTags()].sort(),
      languages: [...this._selectedLanguages()].sort(),
      day: localDayKey(this.clock.now()),
    }),
    { equal: sameQueryParams },
  );

  private readonly viewResource = resource({
    params: () => this.queryParams(),
    loader: ({ params }): Promise<NotesView> => {
      // Lecture délibérément hors suivi : on veut l'instant courant sans que la
      // requête ne se relance à chaque tic (cf. `queryParams`).
      const now = untracked(() => this.clock.now());
      const query: NotesQuery = {
        spaceId: params.spaceId,
        search: params.search,
        filter: params.filter,
        tags: params.tags,
        languages: params.languages,
        now,
        tzOffsetMinutes: now.getTimezoneOffset(),
        // Toujours vrai sur le canevas : l'épinglage y est justement ce qui
        // garde une note à portée, et c'est lui qui fait la section du haut.
        pinnedFirst: true,
      };
      return this.repository.query(query);
    },
  });

  /**
   * Dernière vue obtenue, conservée pendant les rechargements : sans ça, chaque
   * frappe viderait le canevas et l'écran clignoterait.
   *
   * ⚠️ Un `linkedSignal` ne retient que ce qu'il a **vu passer**, sa valeur
   * n'étant recalculée qu'à la lecture. Tout ce que ce store expose lit donc
   * `view()`, et sans court-circuit (cf. `isLoading`).
   */
  private readonly view = linkedSignal<NotesView | undefined, NotesView | null>({
    source: () => (this.viewResource.hasValue() ? this.viewResource.value() : undefined),
    computation: (fresh, previous) => fresh ?? previous?.value ?? null,
  });

  readonly sections = computed<readonly NoteSection[]>(() => this.view()?.sections ?? []);
  readonly allTags = computed<readonly string[]>(() => this.view()?.availableTags ?? []);
  readonly allLanguages = computed<readonly LanguageTag[]>(() => this.view()?.availableLanguages ?? []);
  readonly isFiltering = computed(() => this.view()?.isFiltering ?? false);

  /** Recherche active mais aucun résultat : l'UI doit le dire explicitement. */
  readonly hasNoResults = computed(() => {
    const view = this.view();
    return view !== null && view.isFiltering && view.matched === 0;
  });

  /**
   * Vrai seulement tant qu'aucune vue n'a jamais été obtenue.
   *
   * ⚠️ `view()` est lu **avant** l'état de la ressource : un `&&` dans l'autre
   * sens court-circuiterait la lecture dès le chargement terminé, et la vue
   * fraîchement chargée ne serait jamais retenue.
   */
  readonly isLoading = computed(() => {
    const hasView = this.view() !== null;
    return !hasView && this.viewResource.isLoading();
  });

  readonly loadError: Signal<Error | undefined> = this.viewResource.error;

  /**
   * Les notes affichées, à plat et **dans l'ordre des sections** : c'est l'ordre
   * que suit la navigation au clavier, et celui d'une sélection par plage.
   */
  readonly visibleNotes = computed<readonly Note[]>(() =>
    this.sections().flatMap((section) => [...section.notes]),
  );

  /**
   * Dérivée de ce qui est visible, jamais lue crue : un identifiant coché puis
   * disparu (note supprimée, filtre resserré) ne doit pas partir dans une action
   * de masse.
   */
  readonly checkedNotes = computed<readonly Note[]>(() => {
    const checked = this._checkedIds();
    return this.visibleNotes().filter((note) => checked.has(note.id));
  });

  readonly checkedCount = computed(() => this.checkedNotes().length);
  readonly hasSelection = computed(() => this.checkedCount() > 0);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.cancelPendingSearch();
      this.cancelUndoWindow();
    });
  }

  reload(): void {
    this.viewResource.reload();
  }

  /** Met le champ à jour immédiatement, diffère la requête. */
  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
    this.cancelPendingSearch();
    this.searchTimeout = setTimeout(() => {
      this.searchTimeout = null;
      this._debouncedSearch.set(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  setFilter(filter: NoteFilter): void {
    this._activeFilter.set(filter);
  }

  toggleTag(tag: string): void {
    this._selectedTags.update((tags) => toggled(tags, tag));
  }

  toggleLanguage(language: LanguageTag): void {
    this._selectedLanguages.update((languages) => toggled(languages, language));
  }

  openNote(id: string): void {
    this.discardDraft();
    this._selectedNote.set(this.find(id));
    this._focusedNoteId.set(id);
  }

  /** Un brouillon encore vide à la fermeture est abandonné, pas enregistré. */
  closeOverlay(): void {
    this.discardDraft();
    this._selectedNote.set(null);
  }

  // --- Navigation au clavier ------------------------------------------------

  /** `null` retire le focus du canevas (ouverture d'une modale, par exemple). */
  focusNote(id: string | null): void {
    this._focusedNoteId.set(id);
  }

  /**
   * Index de la note focalisée dans [`visibleNotes`], ou `-1`. Le composant s'en
   * sert pour mesurer la grille et rendre l'index voisin.
   */
  focusedIndex(): number {
    const focused = this._focusedNoteId();
    return focused === null ? -1 : this.visibleNotes().findIndex((note) => note.id === focused);
  }

  /**
   * Focalise par position plutôt que par identifiant : la navigation raisonne
   * en index, seul repère qui survit à une note renommée.
   */
  focusIndex(index: number): void {
    const note = this.visibleNotes()[index];
    if (note) {
      this._focusedNoteId.set(note.id);
    }
  }

  // --- Sélection multiple ---------------------------------------------------

  toggleChecked(id: string): void {
    this._checkedIds.update((checked) => toggled(checked, id));
  }

  /**
   * Coche tout ce qui sépare la note focalisée de `id` — le Maj+clic d'une liste
   * de fichiers. Sans ancre, revient à cocher la seule note désignée.
   */
  checkRangeTo(id: string): void {
    const visible = this.visibleNotes();
    const anchor = this.focusedIndex();
    const target = visible.findIndex((note) => note.id === id);
    if (target < 0) return;

    const from = anchor < 0 ? target : Math.min(anchor, target);
    const to = anchor < 0 ? target : Math.max(anchor, target);

    this._checkedIds.update((checked) => {
      const next = new Set(checked);
      for (const note of visible.slice(from, to + 1)) {
        next.add(note.id);
      }
      return next;
    });
    this._focusedNoteId.set(id);
  }

  clearSelection(): void {
    this._checkedIds.set(new Set());
  }

  /**
   * Les trois actions de masse suivent la même règle que les écritures unitaires :
   * le back tranche, on recharge, rien n'est appliqué localement.
   */
  async moveSelection(spaceId: string): Promise<void> {
    await this.runOnSelection((ids) => this.repository.moveMany(ids, spaceId));
  }

  async tagSelection(tag: string): Promise<void> {
    if (!tag.trim()) return;
    // Aucune normalisation ici : `notes::model::normalize_tags` en est le seul
    // dépositaire, côté Rust.
    await this.runOnSelection((ids) => this.repository.tagMany(ids, [tag]));
  }

  async deleteSelection(): Promise<void> {
    const ids = this.checkedNotes().map((note) => note.id);
    if (ids.length === 0) return;

    try {
      const count = await this.repository.deleteMany(ids);
      this.clearSelection();
      this.openUndoWindow({ ids, count });
      this.reload();
    } catch (error) {
      this.notifier.reportFailure('errors.bulkActionFailed', error);
    }
  }

  // --- Annulation d'une suppression ----------------------------------------

  async undoDeletion(): Promise<void> {
    const deletion = this._lastDeletion();
    if (!deletion) return;

    this.dismissUndo();
    try {
      await this.repository.restore(deletion.ids);
      this.reload();
    } catch (error) {
      this.notifier.reportFailure('errors.trashActionFailed', error);
    }
  }

  /**
   * Masquer le bandeau **renonce** à l'annulation : c'est un geste explicite,
   * contrairement à l'expiration du délai, qui ne fait que ranger l'affichage.
   */
  dismissUndo(): void {
    this.cancelUndoWindow();
    this._undoVisible.set(false);
    this._lastDeletion.set(null);
  }

  togglePinned(id: string): Promise<void> {
    return this.edit(id, (note) => ({ pinned: !note.pinned }));
  }

  /**
   * L'éditeur confirme aussi un titre inchangé (fermeture sans modification),
   * d'où le `null` : rien à persister.
   */
  renameNote(id: string, title: string): Promise<void> {
    return this.edit(id, (note) => (note.title === title ? null : { title }));
  }

  updateContent(id: string, content: string): Promise<void> {
    return this.edit(id, (note) => (note.content === content ? null : { content }));
  }

  /**
   * Fil d'Ariane libre. C'est lui qui rend atteignable la variante `source` du
   * pied de carte, que `domain::note::footer_of` réserve aux notes épinglées.
   */
  setSource(id: string, source: string): Promise<void> {
    return this.edit(id, (note) => (note.source === source ? null : { source }));
  }

  /**
   * `spaceId` est le seul champ que le front pousse sans saisie de
   * l'utilisateur, et le seul dont le stockage refuse la valeur si l'espace
   * n'existe plus.
   */
  moveNote(id: string, spaceId: string): Promise<void> {
    return this.edit(id, (note) => (note.spaceId === spaceId ? null : { spaceId }));
  }

  setLanguage(id: string, language: LanguageTag): Promise<void> {
    return this.edit(id, (note) => (note.language === language ? null : { language }));
  }

  /**
   * Remplace la liste **entière** — cocher, renommer, ajouter, supprimer et
   * réordonner passent tous par là, parce qu'aucun item n'a d'identité propre :
   * sa position est tout ce qui le désigne.
   *
   * La comparaison évite l'écriture inutile que ferait la fermeture de
   * l'éditeur juste après une coche, `updated_at` remontant la note en tête du
   * canevas pour rien.
   */
  setChecklist(id: string, items: readonly ChecklistItem[]): Promise<void> {
    return this.edit(id, (note) =>
      sameItems(note.items, items) ? null : { items: items.map((item) => ({ ...item })) },
    );
  }

  /**
   * Pose ou retire l'échéance. C'est cette écriture, et elle seule, qui alimente
   * le filtre « À trier » et l'indice « à trier bientôt » des sections.
   */
  setLifecycle(id: string, lifecycle: NoteLifecycle): Promise<void> {
    return this.edit(id, (note) => (sameLifecycle(note.lifecycle, lifecycle) ? null : { lifecycle }));
  }

  /**
   * Aucune normalisation ici : trim, `#` de tête et doublons sont tranchés par
   * `domain::rules::normalize_tags`, seul endroit où la règle vit.
   */
  addTag(id: string, tag: string): Promise<void> {
    return this.edit(id, (note) => ({ tags: [...note.tags, tag] }));
  }

  removeTag(id: string, tag: string): Promise<void> {
    return this.edit(id, (note) =>
      note.tags.includes(tag) ? { tags: note.tags.filter((existing) => existing !== tag) } : null,
    );
  }

  /**
   * Ouvre l'éditeur sur un **brouillon local** : rien n'est écrit tant que la
   * note ne vaut pas la peine d'être gardée.
   *
   * En mode « tous les espaces », la note ira dans le premier — il faut bien en
   * choisir un. Sans aucun espace, refus immédiat : une note sans espace serait
   * invisible dès qu'un filtre d'espace est posé.
   *
   * Le type par défaut est `snippet` : c'est ce que les autres chemins de
   * création (carte fantôme, raccourci, palette) veulent tous, et le menu du
   * bouton est le seul endroit d'où l'autre valeur arrive.
   */
  createNote(kind: NoteKind = 'snippet'): void {
    const spaceId = this.spaceForNewNote();
    if (!spaceId) return;

    this._selectedNote.set(null);
    this.draftMaterialisedAs = null;
    this._draftNote.set(emptyNote(spaceId, this.clock.now(), kind));
  }

  /**
   * Note faite du presse-papier, déclenchée par le raccourci global. Elle porte
   * déjà du contenu, donc elle est enregistrée tout de suite — il n'y a rien à
   * attendre.
   */
  async captureFromClipboard(): Promise<void> {
    await this.createWithContent(await this.clipboard.paste());
  }

  /**
   * Note créée d'un seul geste parce qu'elle a déjà son contenu : capture du
   * presse-papier, ou saisie dans la palette. Pas de brouillon ici — il n'y a
   * rien à attendre, et l'éditeur s'ouvre sur une note déjà enregistrée.
   *
   * Un contenu vide ne produit rien : une note vide de plus serait un déchet à
   * ranger, pas une capture.
   */
  async createWithContent(content: string): Promise<void> {
    if (!content.trim()) return;

    const spaceId = this.spaceForNewNote();
    if (!spaceId) return;

    await this.persistNew({ ...emptyDraft(spaceId, 'snippet'), content });
  }

  /**
   * Force l'enregistrement du brouillon et rend son identifiant réel.
   *
   * Utilisé par ce qui exige une note **existante** — joindre un fichier vise
   * une ligne de la base. Rend `null` s'il n'y a rien à enregistrer.
   */
  async materialiseDraft(): Promise<string | null> {
    const persisted = this.persistedNoteId();
    if (persisted) return persisted;

    const draft = this._draftNote();
    if (!draft) return null;

    return this.saveDraft(draft);
  }

  private spaceForNewNote(): string | null {
    const spaceId = this.spaces.activeSpaceId() ?? this.spaces.spaces()[0]?.id;
    if (!spaceId) {
      this.notifier.notify({ ref: { key: 'errors.spaceRequired' } });
      return null;
    }

    return spaceId;
  }

  /**
   * Écrit le brouillon et adopte la note renvoyée. C'est ici, et seulement ici,
   * que `DRAFT_ID` cesse d'exister.
   */
  private async saveDraft(draft: Note): Promise<string | null> {
    const created = await this.persistNew(toDraftPayload(draft));
    if (!created) return null;

    this.draftMaterialisedAs = created.id;
    this._draftNote.set(null);

    return created.id;
  }

  private async persistNew(payload: NoteDraft): Promise<Note | null> {
    try {
      const created = await this.repository.create(payload);
      this._selectedNote.set(created);
      this._focusedNoteId.set(created.id);
      this.reload();
      return created;
    } catch (error) {
      this.notifier.reportFailure('errors.noteCreateFailed', error);
      return null;
    }
  }

  private discardDraft(): void {
    this._draftNote.set(null);
    this.draftMaterialisedAs = null;
  }

  /**
   * Met à la corbeille et propose l'annulation. La note n'est pas perdue passé
   * ce délai : elle y reste 30 jours.
   */
  async deleteNote(id: string): Promise<void> {
    const resolved = this.resolve(id);

    // Un brouillon n'existe nulle part : il n'y a rien à mettre à la corbeille,
    // donc rien non plus à proposer d'annuler.
    if (resolved === DRAFT_ID) {
      this.closeOverlay();
      return;
    }

    if (!this.find(resolved)) return;

    try {
      await this.repository.delete(resolved);
      if (this.selectedNoteId() === resolved) {
        this.closeOverlay();
      }
      this.openUndoWindow({ ids: [resolved], count: 1 });
      this.reload();
    } catch (error) {
      this.notifier.reportFailure('errors.noteDeleteFailed', error);
    }
  }

  /**
   * Enregistre ce qui a été saisi dans les `{{champs}}` d'une note.
   *
   * En dehors d'`edit()` et de `NotePatch` : remplir un champ n'est pas modifier
   * la note. Le back laisse `updatedAt` où il est, et la note ne remonte donc
   * pas en tête du canevas pour une valeur tapée dans le panneau.
   *
   * Une note qui porte des champs porte du contenu : le brouillon vaut déjà
   * d'être enregistré, et `materialiseDraft` lui donne la ligne que l'écriture
   * réclame.
   */
  async setPlaceholderValues(id: string, values: Record<string, string>): Promise<void> {
    const resolved = this.resolve(id);
    const target = resolved === DRAFT_ID ? await this.materialiseDraft() : resolved;
    if (!target) return;

    try {
      const saved = await this.repository.setPlaceholderValues(target, values);
      if (this.persistedNoteId() === target) {
        this._selectedNote.set(saved);
      }
      // Les cartes portent les mêmes valeurs : c'est d'elles que part la copie
      // remplie depuis le canevas.
      this.reload();
    } catch (error) {
      this.notifier.reportFailure('errors.noteSaveFailed', error);
    }
  }

  /**
   * Remplit les `{{champs}}` d'un contenu. Le back en est le seul juge : ce qui
   * est un champ et ce qui est du template Angular s'y décide.
   */
  fillPlaceholders(content: string, values: Record<string, string>): Promise<string> {
    return this.repository.fillPlaceholders(content, values);
  }

  private async runOnSelection(action: (ids: readonly string[]) => Promise<number>): Promise<void> {
    const ids = this.checkedNotes().map((note) => note.id);
    if (ids.length === 0) return;

    try {
      await action(ids);
      this.reload();
    } catch (error) {
      this.notifier.reportFailure('errors.bulkActionFailed', error);
    }
  }

  /**
   * ⚠️ Le bandeau s'efface, **la suppression reste annulable**. Les deux états
   * sont distincts pour que `Ctrl+Z` fonctionne encore après que le bandeau a
   * disparu : masquer une proposition n'est pas y renoncer.
   */
  private openUndoWindow(deletion: Deletion): void {
    this.cancelUndoWindow();
    this._lastDeletion.set(deletion);
    this._undoVisible.set(true);
    this.undoTimeout = setTimeout(() => {
      this.undoTimeout = null;
      this._undoVisible.set(false);
    }, UNDO_WINDOW_MS);
  }

  private cancelUndoWindow(): void {
    if (this.undoTimeout !== null) {
      clearTimeout(this.undoTimeout);
      this.undoTimeout = null;
    }
  }

  /**
   * Squelette commun des huit écritures : retrouver la note, décider du patch,
   * persister. `changes` renvoie `null` quand rien n'a bougé — une note
   * introuvable et une modification nulle ne produisent aucun aller-retour.
   */
  private async edit(id: string, changes: (note: Note) => NotePatch | null): Promise<void> {
    const resolved = this.resolve(id);
    const target = this.find(resolved);
    const patch = target && changes(target);
    if (!patch) return;

    if (resolved === DRAFT_ID) {
      await this.editDraft(target, patch);
      return;
    }

    await this.persist(resolved, patch);
  }

  /**
   * Une écriture sur un brouillon reste **locale** tant que la note ne vaut pas
   * la peine d'être gardée : changer le langage d'une note vide ne doit pas la
   * faire apparaître sur le canevas.
   */
  private async editDraft(draft: Note, patch: NotePatch): Promise<void> {
    const updated: Note = { ...draft, ...patch };

    if (!isWorthSaving(updated)) {
      this._draftNote.set(updated);
      return;
    }

    await this.saveDraft(updated);
  }

  /**
   * `DRAFT_ID` désigne le brouillon **ou** la note qu'il est devenu : l'éditeur
   * enchaîne plusieurs confirmations sans que la vue ait été recalculée entre
   * les deux, et continue donc d'envoyer l'ancien identifiant.
   */
  private resolve(id: string): string {
    return id === DRAFT_ID && this.draftMaterialisedAs ? this.draftMaterialisedAs : id;
  }

  /**
   * Persiste puis recharge. La note renvoyée fait autorité : elle porte ce que
   * le backend a réellement écrit (`updatedAt`, tags normalisés, pied de carte).
   *
   * `NotePatch` et non `Partial<Note>` : le second laisserait passer `id`,
   * `createdAt` ou `footer` jusqu'à la frontière du dépôt.
   */
  private async persist(id: string, patch: NotePatch): Promise<void> {
    try {
      const saved = await this.repository.update(id, patch);
      if (this.persistedNoteId() === id) {
        this._selectedNote.set(saved);
      }
      this.reload();
    } catch (error) {
      this.notifier.reportFailure('errors.noteSaveFailed', error);
    }
  }

  /**
   * La note ouverte est consultée en premier : elle a pu sortir de la vue
   * filtrée depuis son ouverture sans cesser d'être éditable.
   */
  private find(id: string): Note | null {
    const draft = this._draftNote();
    if (draft?.id === id) return draft;

    const selected = this._selectedNote();
    if (selected?.id === id) return selected;

    for (const section of this.sections()) {
      const found = section.notes.find((note) => note.id === id);
      if (found) return found;
    }
    return null;
  }

  private cancelPendingSearch(): void {
    if (this.searchTimeout !== null) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
  }
}
