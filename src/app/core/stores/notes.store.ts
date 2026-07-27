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
import { NOTES_REPOSITORY } from '../data/notes-repository.token';
import { ErrorNotifier } from '../errors/error-notifier.service';
import { ipcNotice } from '../errors/ipc-notice';
import { FALLBACK_LANGUAGE, LanguageTag } from '../models/language.model';
import { NoteSection } from '../models/note-section.model';
import { Note, NoteDraft, NotePatch } from '../models/note.model';
import { NoteFilter, NotesQuery, NotesView } from '../models/notes-query.model';
import { ClockService } from '../time/clock.service';
import { SpacesStore } from './spaces.store';

export type { NoteFilter } from '../models/notes-query.model';

/**
 * Délai avant qu'une frappe ne parte en requête. Chaque caractère déclencherait
 * sinon un aller-retour IPC ; 150 ms couvrent une frappe continue tout en
 * restant sous le seuil de perception.
 */
export const SEARCH_DEBOUNCE_MS = 150;

/** Clé de journée **locale**, utilisée pour ne re-interroger qu'au changement de jour. */
function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

interface QueryParams {
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  readonly day: string;
}

/**
 * Égalité **par valeur** des critères de requête.
 *
 * `resource` compare ses paramètres par identité (`===`) : sans ce comparateur,
 * le littéral neuf que produit `queryParams` à chaque battement d'horloge
 * relancerait une requête toutes les 30 s, masquée par le cache de vue.
 */
function sameQueryParams(a: QueryParams, b: QueryParams): boolean {
  return (
    a.spaceId === b.spaceId &&
    a.search === b.search &&
    a.filter === b.filter &&
    a.day === b.day &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}

/**
 * État des notes.
 *
 * Ce store ne filtre pas, ne trie pas et ne regroupe pas : il décrit ce que
 * l'utilisateur demande (espace, recherche, filtre, tags) et affiche la **vue**
 * que le backend renvoie. Toute la logique correspondante vit dans
 * `src-tauri/src/storage/` — voir `docs/architecture.md`.
 *
 * Deux principes structurent la classe :
 *
 * 1. **Les signaux inscriptibles restent privés**, exposés en lecture seule.
 *    Toute mutation passe donc par une méthode.
 * 2. **Le backend fait autorité.** Une écriture n'est pas appliquée localement :
 *    on persiste, puis on recharge la vue. Rien à annuler en cas d'échec, et
 *    aucun risque que l'écran diverge de la base.
 */
@Injectable({ providedIn: 'root' })
export class NotesStore {
  private readonly repository = inject(NOTES_REPOSITORY);
  private readonly clock = inject(ClockService);
  private readonly notifier = inject(ErrorNotifier);
  private readonly spaces = inject(SpacesStore);

  private readonly _searchQuery = signal('');
  private readonly _debouncedSearch = signal('');
  private readonly _activeFilter = signal<NoteFilter>('all');
  private readonly _selectedTags = signal<ReadonlySet<string>>(new Set());
  private readonly _selectedNote = signal<Note | null>(null);

  /** Reflète la frappe sans attendre : c'est la valeur affichée dans le champ. */
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();
  readonly selectedTags = this._selectedTags.asReadonly();
  readonly selectedNote = this._selectedNote.asReadonly();
  readonly selectedNoteId = computed<string | null>(() => this._selectedNote()?.id ?? null);

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Critères déclenchant une nouvelle requête. L'instant exact n'en fait pas
   * partie — seule la **journée** compte pour le découpage en sections.
   *
   * ⚠️ Le comparateur `equal` est indispensable : `localDayKey` stabilise la
   * *valeur* du jour, mais l'objet qui l'enveloppe est neuf à chaque battement
   * d'horloge, et `resource` compare ses paramètres par identité.
   */
  private readonly queryParams = computed<QueryParams>(
    () => ({
      spaceId: this.spaces.activeSpaceId(),
      search: this._debouncedSearch().trim(),
      filter: this._activeFilter(),
      tags: [...this._selectedTags()].sort(),
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
        now,
        tzOffsetMinutes: now.getTimezoneOffset(),
      };
      return this.repository.query(query);
    },
  });

  /**
   * Dernière vue obtenue, conservée pendant les rechargements.
   *
   * Sans ça, chaque frappe viderait le canevas le temps de l'aller-retour et
   * l'écran clignoterait entre « Chargement… » et les résultats. Une vue
   * légèrement en retard vaut mieux qu'une vue absente.
   *
   * ⚠️ Un `linkedSignal` ne retient que ce qu'il a **vu passer** : sa valeur
   * n'est recalculée qu'à la lecture. Tout ce que ce store expose lit donc
   * `view()`, et sans court-circuit (cf. `isLoading`) — sans quoi une vue
   * chargée puis remplacée entre deux lectures serait perdue.
   */
  private readonly view = linkedSignal<NotesView | undefined, NotesView | null>({
    source: () => (this.viewResource.hasValue() ? this.viewResource.value() : undefined),
    computation: (fresh, previous) => fresh ?? previous?.value ?? null,
  });

  readonly sections = computed<readonly NoteSection[]>(() => this.view()?.sections ?? []);
  readonly allTags = computed<readonly string[]>(() => this.view()?.availableTags ?? []);
  readonly isFiltering = computed(() => this.view()?.isFiltering ?? false);

  /** Recherche active mais aucun résultat : l'UI doit le dire explicitement. */
  readonly hasNoResults = computed(() => {
    const view = this.view();
    return view !== null && view.isFiltering && view.matched === 0;
  });

  /**
   * Vrai uniquement tant qu'aucune vue n'a jamais été obtenue : un rechargement
   * ultérieur laisse les résultats précédents à l'écran.
   *
   * `view()` est lu **avant** l'état de la ressource, et non après : un `&&`
   * dans l'autre sens court-circuiterait la lecture dès que le chargement est
   * terminé, et la vue fraîchement chargée ne serait jamais retenue.
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

  /**
   * Met le champ à jour immédiatement et diffère la requête : la recherche
   * traverse le pont IPC, un appel par caractère serait gâché.
   */
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
    this._selectedTags.update((tags) => {
      const next = new Set(tags);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  openNote(id: string): void {
    this._selectedNote.set(this.find(id));
  }

  closeOverlay(): void {
    this._selectedNote.set(null);
  }

  async togglePinned(id: string): Promise<void> {
    const target = this.find(id);
    if (!target) return;

    await this.persist(id, { pinned: !target.pinned });
  }

  async renameNote(id: string, title: string): Promise<void> {
    const target = this.find(id);
    // L'éditeur peut confirmer un titre inchangé (fermeture sans modification) :
    // ne rien persister dans ce cas.
    if (!target || target.title === title) return;

    await this.persist(id, { title });
  }

  async updateContent(id: string, content: string): Promise<void> {
    const target = this.find(id);
    if (!target || target.content === content) return;

    await this.persist(id, { content });
  }

  async setLanguage(id: string, language: LanguageTag): Promise<void> {
    const target = this.find(id);
    if (!target || target.language === language) return;

    await this.persist(id, { language });
  }

  /**
   * Ajoute un tag. Aucune normalisation ici : trim, `#` de tête et doublons sont
   * tranchés par `domain::tags::normalize`, seul endroit où la règle
   * vit. Le front envoie ce que l'utilisateur a tapé.
   */
  async addTag(id: string, tag: string): Promise<void> {
    const target = this.find(id);
    if (!target) return;

    await this.persist(id, { tags: [...target.tags, tag] });
  }

  async removeTag(id: string, tag: string): Promise<void> {
    const target = this.find(id);
    if (!target || !target.tags.includes(tag)) return;

    await this.persist(id, { tags: target.tags.filter((existing) => existing !== tag) });
  }

  /**
   * Crée une note vide dans l'espace actif et l'ouvre. L'identifiant est
   * attribué par la persistance : afficher la note sous un identifiant
   * provisoire obligerait à le corriger après coup, sélection comprise.
   *
   * Sans espace actif (mode « tous les espaces »), la note part dans le premier
   * espace : il faut bien en choisir un, et le premier est celui que le
   * sélecteur montre en tête. S'il n'existe aucun espace, la création échoue —
   * une note sans espace serait invisible dès qu'un filtre d'espace est posé.
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
      this.reportFailure('errors.noteCreateFailed', error);
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
      this.reportFailure('errors.noteDeleteFailed', error);
    }
  }

  /**
   * Persiste puis recharge. La note renvoyée fait autorité : elle est adoptée
   * telle quelle dans l'éditeur, car elle porte ce que le backend a réellement
   * écrit (`updatedAt`, tags normalisés, pied de carte).
   *
   * Le patch est typé `NotePatch` et non `Partial<Note>` : le second laisserait
   * passer `id`, `createdAt` ou `footer` jusqu'à la frontière du dépôt, où seule
   * la recopie manuelle de `toNotePatchDto` les arrêterait.
   */
  private async persist(id: string, patch: NotePatch): Promise<void> {
    try {
      const saved = await this.repository.update(id, patch);
      if (this.selectedNoteId() === id) {
        this._selectedNote.set(saved);
      }
      this.reload();
    } catch (error) {
      this.reportFailure('errors.noteSaveFailed', error);
    }
  }

  /**
   * La note ouverte est consultée en premier : elle peut être sortie de la vue
   * filtrée depuis son ouverture (retrait de son dernier tag filtrant) sans
   * cesser d'être éditable.
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

  /**
   * `key` décrit l'action tentée ; si le back a nommé la cause, `ipcNotice` lui
   * donne la priorité — « cette note n'existe plus » est plus utile que
   * « impossible d'enregistrer ».
   */
  private reportFailure(key: string, error: unknown): void {
    console.error(error);
    this.notifier.notify(ipcNotice(error, { key }));
  }
}
