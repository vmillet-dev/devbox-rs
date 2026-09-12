import { Signal, computed, inject, linkedSignal, resource, untracked } from '@angular/core';
import { Injectable, signal } from '@angular/core';
import { LanguageTag } from '@core/model/language.model';
import { ClockService } from '@core/services/time/clock.service';
import { SEARCH_DEBOUNCE_MS, debounced } from '@core/services/time/debounce';
import { NotesRepository } from '../data/notes.repository';
import { Note, NoteFilter, NoteSection, NotesQuery, NotesView } from '../model/note.model';
import { NotesRevision } from './notes-revision';
import { SpacesStore } from './spaces.store';

export type { NoteFilter } from '../model/note.model';

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
 * ⚠️ `resource` compares its params by identity: without this comparator, the fresh
 * literal `queryParams` builds on every clock tick fires a full query every 30 s.
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

function toggled<T>(selection: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(selection);
  if (!next.delete(value)) {
    next.add(value);
  }
  return next;
}

/**
 * It filters, sorts and groups nothing: `query_notes` returns a ready-to-render
 * `NotesView` and this store displays it. Everything here is about *which* notes —
 * writing one is [`NotesStore`]'s business, pointing at one [`NoteSelectionStore`]'s.
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
   * Only the **day** matters for the section split, not the exact instant. The
   * `equal` comparator is load-bearing, see `sameQueryParams`.
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
      // Untracked: the current instant, without the query re-running on every tick.
      const now = untracked(() => this.clock.now());
      const query: NotesQuery = {
        spaceId: params.spaceId,
        search: params.search,
        filter: params.filter,
        tags: params.tags,
        languages: params.languages,
        now,
        tzOffsetMinutes: now.getTimezoneOffset(),
        // Always true on the canvas: pinning is what keeps a note within reach there.
        pinnedFirst: true,
      };
      return this.repository.query(query);
    },
  });

  /**
   * Kept during reloads, or every keystroke would blank the canvas.
   *
   * ⚠️ A `linkedSignal` only retains what it has **seen go past**: everything this
   * store exposes therefore reads `view()`, with no short-circuit (see `isLoading`).
   */
  private readonly view = linkedSignal<NotesView | undefined, NotesView | null>({
    source: () => (this.viewResource.hasValue() ? this.viewResource.value() : undefined),
    computation: (fresh, previous) => fresh ?? previous?.value ?? null,
  });

  readonly sections = computed<readonly NoteSection[]>(() => this.view()?.sections ?? []);
  readonly allTags = computed<readonly string[]>(() => this.view()?.availableTags ?? []);
  readonly allLanguages = computed<readonly LanguageTag[]>(() => this.view()?.availableLanguages ?? []);
  readonly isFiltering = computed(() => this.view()?.isFiltering ?? false);

  readonly hasNoResults = computed(() => {
    const view = this.view();
    return view !== null && view.isFiltering && view.matched === 0;
  });

  /**
   * ⚠️ `view()` is read **before** the resource state: an `&&` the other way round
   * would short-circuit past the read, dropping the freshly loaded view.
   */
  readonly isLoading = computed(() => {
    const hasView = this.view() !== null;
    return !hasView && this.viewResource.isLoading();
  });

  readonly loadError: Signal<Error | undefined> = this.viewResource.error;

  /** Flat and **in section order**: what keyboard navigation follows, and what a
   * range selection spans. */
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

  findVisible(id: string): Note | null {
    for (const section of this.sections()) {
      const found = section.notes.find((note) => note.id === id);
      if (found) return found;
    }
    return null;
  }
}
