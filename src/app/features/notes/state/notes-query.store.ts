import { Signal, computed, inject, linkedSignal, resource, untracked } from '@angular/core';
import { Injectable, signal } from '@angular/core';
import { LanguageTag } from '@core/language/language.model';
import { ClockService } from '@core/time/clock.service';
import { SEARCH_DEBOUNCE_MS, debounced } from '@core/time/debounce';
import { NotesRepository } from '../data/notes.repository';
import { Note, NoteFilter, NoteSection, NotesQuery, NotesView } from '../model/note.model';
import { NotesRevision } from './notes-revision';
import { SpacesStore } from './spaces.store';

export type { NoteFilter } from '../model/note.model';

// Re-exported so the search delay and the store that uses it stay one import
// away from each other.
export { SEARCH_DEBOUNCE_MS };

/** The **local** day: a new query only on a day change. */
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
  /** Bumped by whoever wrote notes from outside this store. */
  readonly revision: number;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * ⚠️ `resource` compares its params by identity: without this comparator, the
 * fresh literal `queryParams` builds on every clock tick would fire a full
 * query every 30 s, hidden behind the retained view.
 */
function sameQueryParams(a: QueryParams, b: QueryParams): boolean {
  return (
    a.spaceId === b.spaceId &&
    a.search === b.search &&
    a.filter === b.filter &&
    a.day === b.day &&
    a.revision === b.revision &&
    sameStrings(a.tags, b.tags) &&
    sameStrings(a.languages, b.languages)
  );
}

/** A fresh set, never mutated. */
function toggled<T>(selection: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(selection);
  if (!next.delete(value)) {
    next.add(value);
  }
  return next;
}

/**
 * What the canvas shows: the question asked of the back end, and the answer.
 *
 * It filters, sorts and groups nothing — `query_notes` returns a ready-to-render
 * `NotesView` and this store displays it. Everything here is about *which*
 * notes, never about their contents: writing one is [`NotesStore`]'s business,
 * and pointing at one is [`NoteSelectionStore`]'s.
 */
@Injectable({ providedIn: 'root' })
export class NotesQueryStore {
  private readonly repository = inject(NotesRepository);
  private readonly clock = inject(ClockService);
  private readonly spaces = inject(SpacesStore);
  private readonly revision = inject(NotesRevision);

  private readonly _searchQuery = signal('');
  private readonly _debouncedSearch = signal('');
  private readonly _activeFilter = signal<NoteFilter>('all');
  private readonly _selectedTags = signal<ReadonlySet<string>>(new Set());
  private readonly _selectedLanguages = signal<ReadonlySet<LanguageTag>>(new Set());

  /** Follows the typing without waiting: this is what the field shows. */
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();
  readonly selectedTags = this._selectedTags.asReadonly();
  readonly selectedLanguages = this._selectedLanguages.asReadonly();

  private readonly commitSearch = debounced(
    (query: string) => this._debouncedSearch.set(query),
    SEARCH_DEBOUNCE_MS,
  );

  /**
   * What triggers a query. The exact instant is not part of it: only the **day**
   * matters for the section split. The `equal` comparator is load-bearing, see
   * `sameQueryParams`.
   */
  private readonly queryParams = computed<QueryParams>(
    () => ({
      spaceId: this.spaces.activeSpaceId(),
      search: this._debouncedSearch().trim(),
      filter: this._activeFilter(),
      tags: [...this._selectedTags()].sort(),
      languages: [...this._selectedLanguages()].sort(),
      day: localDayKey(this.clock.now()),
      revision: this.revision.current(),
    }),
    { equal: sameQueryParams },
  );

  private readonly viewResource = resource({
    params: () => this.queryParams(),
    loader: ({ params }): Promise<NotesView> => {
      // Deliberately untracked: we want the current instant without the query
      // re-running on every tick (see `queryParams`).
      const now = untracked(() => this.clock.now());
      const query: NotesQuery = {
        spaceId: params.spaceId,
        search: params.search,
        filter: params.filter,
        tags: params.tags,
        languages: params.languages,
        now,
        tzOffsetMinutes: now.getTimezoneOffset(),
        // Always true on the canvas: pinning is what keeps a note within reach
        // there, and what makes the top section.
        pinnedFirst: true,
      };
      return this.repository.query(query);
    },
  });

  /**
   * The last view obtained, kept during reloads: without it every keystroke
   * would blank the canvas.
   *
   * ⚠️ A `linkedSignal` only retains what it has **seen go past**, its value
   * being recomputed on read. Everything this store exposes therefore reads
   * `view()`, with no short-circuit (see `isLoading`).
   */
  private readonly view = linkedSignal<NotesView | undefined, NotesView | null>({
    source: () => (this.viewResource.hasValue() ? this.viewResource.value() : undefined),
    computation: (fresh, previous) => fresh ?? previous?.value ?? null,
  });

  readonly sections = computed<readonly NoteSection[]>(() => this.view()?.sections ?? []);
  readonly allTags = computed<readonly string[]>(() => this.view()?.availableTags ?? []);
  readonly allLanguages = computed<readonly LanguageTag[]>(() => this.view()?.availableLanguages ?? []);
  readonly isFiltering = computed(() => this.view()?.isFiltering ?? false);

  /** A search is running but found nothing: the UI has to say so. */
  readonly hasNoResults = computed(() => {
    const view = this.view();
    return view !== null && view.isFiltering && view.matched === 0;
  });

  /**
   * True only while no view has ever been obtained.
   *
   * ⚠️ `view()` is read **before** the resource state: an `&&` the other way
   * round would short-circuit past the read once loading finishes, and the
   * freshly loaded view would never be retained.
   */
  readonly isLoading = computed(() => {
    const hasView = this.view() !== null;
    return !hasView && this.viewResource.isLoading();
  });

  readonly loadError: Signal<Error | undefined> = this.viewResource.error;

  /**
   * The displayed notes, flat and **in section order**: what keyboard
   * navigation follows, and what a range selection spans.
   */
  readonly visibleNotes = computed<readonly Note[]>(() =>
    this.sections().flatMap((section) => [...section.notes]),
  );

  reload(): void {
    this.viewResource.reload();
  }

  /** Updates the field at once, defers the query. */
  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
    this.commitSearch(query);
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

  /** The note under that id **as the canvas currently shows it**, or `null`. */
  findVisible(id: string): Note | null {
    for (const section of this.sections()) {
      const found = section.notes.find((note) => note.id === id);
      if (found) return found;
    }
    return null;
  }
}
