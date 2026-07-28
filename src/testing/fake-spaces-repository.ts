import { SpacesRepository } from '@core/data/spaces-repository.token';
import { Space, SpaceDraft } from '@core/models/space.model';

/**
 * In-memory `SpacesRepository` test double.
 *
 * Like `FakeNotesRepository`, it owns the list and assigns ids, and it can be
 * made to reject through `failNext` so failure paths are testable.
 */
export class FakeSpacesRepository implements SpacesRepository {
  private spaces: readonly Space[];
  private nextId = 0;

  /** When set, the next call to any method rejects with this error, then clears. */
  failNext: Error | null = null;

  constructor(spaces: readonly Space[] = []) {
    this.spaces = spaces;
  }

  loadAll(): Promise<readonly Space[]> {
    return this.guard(() => this.spaces);
  }

  create(draft: SpaceDraft): Promise<Space> {
    return this.guard(() => {
      const space: Space = { id: `fake-space-${++this.nextId}`, name: draft.name };
      this.spaces = [...this.spaces, space];
      return space;
    });
  }

  rename(id: string, draft: SpaceDraft): Promise<Space> {
    return this.guard(() => {
      const renamed: Space = { id, name: draft.name };
      this.spaces = this.spaces.map((space) => (space.id === id ? renamed : space));
      return renamed;
    });
  }

  /**
   * The target is accepted without checking it holds the notes: this double owns
   * no notes at all. `NotesStore` reloads from its own repository afterwards,
   * which is what the move is observable through.
   */
  delete(id: string, _targetSpaceId: string): Promise<void> {
    return this.guard(() => {
      this.spaces = this.spaces.filter((space) => space.id !== id);
    });
  }

  private guard<T>(operation: () => T): Promise<T> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return Promise.reject(error);
    }
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
