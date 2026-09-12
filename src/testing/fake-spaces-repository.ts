import { guard } from './fail-next';
import { SpacesRepository } from '@features/notes/data/spaces.repository';
import { Space, SpaceDraft } from '@features/notes/model/space.model';

/**
 * Like `FakeNotesRepository`: it owns the list, assigns ids, and can be made to reject
 * through `failNext`. See that file for why the implemented type is a `Pick`.
 */
export class FakeSpacesRepository implements Pick<SpacesRepository, keyof SpacesRepository> {
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
   * The target is accepted without checking it holds the notes: this double owns none.
   * `NotesStore` reloads from its own repository afterwards.
   */
  delete(id: string, _targetSpaceId: string): Promise<void> {
    return guard(this, () => {
      this.spaces = this.spaces.filter((space) => space.id !== id);
    });
  }
}
