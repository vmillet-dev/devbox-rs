import { guard } from './fail-next';
import { SpacesRepository } from '@core/data/spaces.repository';
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
    return guard(this, () => this.spaces);
  }

  create(draft: SpaceDraft): Promise<Space> {
    return guard(this, () => {
      const space: Space = { id: `fake-space-${++this.nextId}`, name: draft.name };
      this.spaces = [...this.spaces, space];
      return space;
    });
  }

  rename(id: string, draft: SpaceDraft): Promise<Space> {
    return guard(this, () => {
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
    return guard(this, () => {
      this.spaces = this.spaces.filter((space) => space.id !== id);
    });
  }
}
