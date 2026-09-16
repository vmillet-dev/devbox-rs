import { Injectable, Signal, computed, effect, inject, resource, signal, untracked } from '@angular/core';
import { ErrorNotifier } from '@core/services/errors/error-notifier.service';
import { PreferencesService } from '@core/services/preferences/preferences.service';
import { ClockService } from '@core/services/time/clock.service';
import { BoardRepository } from '../data/board.repository';
import { LanguageTag } from '../model/language.model';
import { BoardNote, BoardQuery, BoardView, BoardZone, NotesViewMode } from '../model/board.model';
import { NoteFilter } from '../model/note.model';
import { NotesQueryStore } from './notes-query.store';
import { NotesRevision } from './notes-revision';
import { SpacesStore } from './spaces.store';

/**
 * ⚠️ One key per space, not one serialised map: a user who arranges their SQL space and
 * leaves the others alone must not have the switch follow them around.
 */
function preferenceKey(spaceId: string): string {
  return `devbox.notes.view.${spaceId}`;
}

interface BoardParams {
  readonly spaceId: string;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  readonly languages: readonly LanguageTag[];
  /** Bumped by whoever wrote notes from outside: the board re-reads on its own. */
  readonly revision: number;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Exhaustive by construction, like the canvas's: a new field stops this compiling. */
const SAME: { readonly [K in keyof BoardParams]: (a: BoardParams[K], b: BoardParams[K]) => boolean } = {
  spaceId: Object.is,
  search: Object.is,
  filter: Object.is,
  revision: Object.is,
  tags: sameStrings,
  languages: sameStrings,
};

/** `undefined` on either side is "do not ask", and only equal to itself. */
function sameBoardParams(a: BoardParams | undefined, b: BoardParams | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;

  return (Object.keys(SAME) as (keyof BoardParams)[]).every((key) => {
    const same = SAME[key] as (a: unknown, b: unknown) => boolean;
    return same(a[key], b[key]);
  });
}

/**
 * Which of the two views is showing, and what the board draws.
 *
 * ⚠️ The board is unavailable on "all spaces": a folder belongs to a space, so there would
 * be no zones to draw. The switch falls back to the date view rather than disappearing
 * mid-gesture.
 */
@Injectable({ providedIn: 'root' })
export class BoardStore {
  private readonly repository = inject(BoardRepository);
  private readonly notifier = inject(ErrorNotifier);
  private readonly preferences = inject(PreferencesService);
  private readonly clock = inject(ClockService);
  private readonly spaces = inject(SpacesStore);
  private readonly canvas = inject(NotesQueryStore);
  private readonly revision = inject(NotesRevision);

  /** What the user asked for; `mode` is what they actually get. */
  private readonly wanted = signal<NotesViewMode>('date');

  readonly canShowBoard = computed(() => this.spaces.activeSpaceId() !== null);

  readonly mode = computed<NotesViewMode>(() => (this.canShowBoard() ? this.wanted() : 'date'));

  readonly isBoard = computed(() => this.mode() === 'board');

  constructor() {
    // Restores the switch as the space changes: it is remembered per space.
    effect(() => {
      const spaceId = this.spaces.activeSpaceId();
      untracked(() => {
        this.wanted.set(
          spaceId !== null && this.preferences.read(preferenceKey(spaceId)) === 'board' ? 'board' : 'date',
        );
      });
    });

    effect(() => {
      const error = this.loadError();
      if (error) {
        this.notifier.notify({ ref: { key: 'errors.boardLoadFailed' }, detail: error.message });
      }
    });
  }

  /**
   * ⚠️ `undefined` means "do not ask", which is what keeps the board idle on the date
   * view, and an `equal` comparator is what keeps the fresh literal from firing a query
   * on every clock tick — the same trap `NotesQueryStore` documents.
   */
  private readonly queryParams = computed<BoardParams | undefined>(
    () => {
      const spaceId = this.spaces.activeSpaceId();
      if (spaceId === null || !this.isBoard()) return undefined;

      return {
        spaceId,
        search: this.canvas.debouncedSearch().trim(),
        filter: this.canvas.activeFilter(),
        tags: [...this.canvas.selectedTags()].sort(),
        languages: [...this.canvas.selectedLanguages()].sort(),
        revision: this.revision.current(),
      };
    },
    { equal: sameBoardParams },
  );

  private readonly viewResource = resource({
    params: () => this.queryParams(),
    loader: ({ params }): Promise<BoardView> => {
      const query: BoardQuery = {
        spaceId: params.spaceId,
        search: params.search,
        filter: params.filter,
        tags: params.tags,
        languages: params.languages,
        // Untracked: the current instant, without the query re-running on every tick.
        now: untracked(() => this.clock.now()),
      };
      return this.repository.query(query);
    },
  });

  /** Kept during a reload, like the canvas's: the board must not blank on a keystroke. */
  private readonly view = computed<BoardView | null>(() =>
    this.viewResource.hasValue() ? this.viewResource.value() : null,
  );

  readonly zones = computed<readonly BoardZone[]>(() => this.view()?.zones ?? []);
  readonly loose = computed<readonly BoardNote[]>(() => this.view()?.loose ?? []);
  readonly isFiltering = computed(() => this.view()?.isFiltering ?? false);
  readonly width = computed(() => this.view()?.width ?? 0);
  readonly height = computed(() => this.view()?.height ?? 0);

  readonly isLoading = computed(() => this.view() === null && this.viewResource.isLoading());
  readonly loadError: Signal<Error | undefined> = this.viewResource.error;

  /** `null` when nothing is dimming anything. */
  readonly matched = computed<number | null>(() => {
    const view = this.view();
    return view !== null && view.isFiltering ? view.matched : null;
  });

  readonly noteCount = computed(
    () => this.zones().reduce((total, zone) => total + zone.notes.length, 0) + this.loose().length,
  );

  setMode(mode: NotesViewMode): void {
    this.wanted.set(mode);

    const spaceId = this.spaces.activeSpaceId();
    if (spaceId !== null) {
      this.preferences.write(preferenceKey(spaceId), mode);
    }
  }

  reload(): void {
    this.viewResource.reload();
  }
}
