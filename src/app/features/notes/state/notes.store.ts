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
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { FALLBACK_LANGUAGE, LanguageTag } from '@core/language/language.model';
import {
  Note,
  NoteDraft,
  NoteFilter,
  NoteLifecycle,
  NotePatch,
  NoteSection,
  NotesQuery,
  NotesView,
} from '../model/note.model';
import { ClockService } from '@core/time/clock.service';
import { SpacesStore } from './spaces.store';

export type { NoteFilter } from '../model/note.model';

/** La recherche traverse le pont IPC : un appel par caractère serait gâché. */
export const SEARCH_DEBOUNCE_MS = 150;

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
  private readonly clock = inject(ClockService);
  private readonly notifier = inject(ErrorNotifier);
  private readonly spaces = inject(SpacesStore);

  private readonly _searchQuery = signal('');
  private readonly _debouncedSearch = signal('');
  private readonly _activeFilter = signal<NoteFilter>('all');
  private readonly _selectedTags = signal<ReadonlySet<string>>(new Set());
  private readonly _selectedLanguages = signal<ReadonlySet<LanguageTag>>(new Set());
  private readonly _selectedNote = signal<Note | null>(null);

  /** Reflète la frappe sans attendre : c'est la valeur affichée dans le champ. */
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();
  readonly selectedTags = this._selectedTags.asReadonly();
  readonly selectedLanguages = this._selectedLanguages.asReadonly();
  readonly selectedNote = this._selectedNote.asReadonly();
  readonly selectedNoteId = computed<string | null>(() => this._selectedNote()?.id ?? null);

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

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

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelPendingSearch());
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
    this._selectedNote.set(this.find(id));
  }

  closeOverlay(): void {
    this._selectedNote.set(null);
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
   * Crée une note vide dans l'espace actif et l'ouvre ; l'identifiant est
   * attribué par la persistance.
   *
   * En mode « tous les espaces », la note part dans le premier — il faut bien en
   * choisir un. Sans aucun espace la création échoue : une note sans espace
   * serait invisible dès qu'un filtre d'espace est posé.
   */
  async createNote(): Promise<void> {
    const spaceId = this.spaces.activeSpaceId() ?? this.spaces.spaces()[0]?.id;
    if (!spaceId) {
      this.notifier.notify({ ref: { key: 'errors.spaceRequired' } });
      return;
    }

    const draft: NoteDraft = {
      spaceId,
      // Titre et source vides : l'UI affiche des libellés de remplacement
      // traduits. Stocker « Nouvelle note » en dur figerait du français
      // dans les données.
      title: '',
      language: FALLBACK_LANGUAGE,
      content: '',
      source: '',
      tags: [],
      pinned: false,
      lifecycle: { kind: 'permanent' },
    };

    try {
      const created = await this.repository.create(draft);
      this._selectedNote.set(created);
      this.reload();
    } catch (error) {
      this.notifier.reportFailure('errors.noteCreateFailed', error);
    }
  }

  async deleteNote(id: string): Promise<void> {
    if (!this.find(id)) return;

    try {
      await this.repository.delete(id);
      if (this.selectedNoteId() === id) {
        this.closeOverlay();
      }
      this.reload();
    } catch (error) {
      this.notifier.reportFailure('errors.noteDeleteFailed', error);
    }
  }

  /**
   * Squelette commun des huit écritures : retrouver la note, décider du patch,
   * persister. `changes` renvoie `null` quand rien n'a bougé — une note
   * introuvable et une modification nulle ne produisent aucun aller-retour.
   */
  private async edit(id: string, changes: (note: Note) => NotePatch | null): Promise<void> {
    const target = this.find(id);
    const patch = target && changes(target);
    if (patch) {
      await this.persist(id, patch);
    }
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
      if (this.selectedNoteId() === id) {
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
