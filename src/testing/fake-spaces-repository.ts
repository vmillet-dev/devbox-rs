import { guard } from './fail-next';
import { SpacesRepository } from '@core/data/spaces.repository';
import { Space, SpaceDraft } from '@core/model/space.model';

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
      const space: Space = { id: `fake-space-${++this.nextId}`, name: draft.name, pinned: false };
      this.spaces = [...this.spaces, space];
      return space;
    });
  }

  rename(id: string, draft: SpaceDraft): Promise<Space> {
    return guard(this, () => {
      const existing = this.spaces.find((space) => space.id === id);
      const renamed: Space = { id, name: draft.name, pinned: existing?.pinned ?? false };
      this.spaces = this.spaces.map((space) => (space.id === id ? renamed : space));
      return renamed;
    });
  }

  /**
   * Hoists to the head of the list, like the real one — the order is the whole point,
   * so a double that only flipped the flag would let a broken sort pass.
   */
  setPinned(id: string, pinned: boolean): Promise<Space> {
    return guard(this, () => {
      const updated = this.spaces.map((space) => (space.id === id ? { ...space, pinned } : space));
      this.spaces = [...updated].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name),
      );

      const found = this.spaces.find((space) => space.id === id);
      if (!found) {
        throw new Error(`Unknown space: ${id}`);
      }
      return found;
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
