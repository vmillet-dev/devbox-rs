import { Injectable, Signal, computed, effect, inject, resource, signal } from '@angular/core';
import { SpacesRepository } from '../data/spaces.repository';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { Space } from '../model/space.model';
import { NotesRevision } from './notes-revision';

/**
 * The available spaces and the active one. The active space is a **filter**:
 * `NotesStore` reads it to narrow the view, and `createNote` files there.
 *
 * `null` is not a waiting state but a choice — "all spaces". No "All" entry
 * exists on the data side: it would be a phantom space notes could be filed
 * into by mistake.
 */
@Injectable({ providedIn: 'root' })
export class SpacesStore {
  private readonly repository = inject(SpacesRepository);
  private readonly notifier = inject(ErrorNotifier);
  private readonly revision = inject(NotesRevision);

  private readonly spacesResource = resource({
    loader: () => this.repository.loadAll(),
    defaultValue: [] as readonly Space[],
  });

  readonly spaces = computed<readonly Space[]>(() =>
    this.spacesResource.hasValue() ? this.spacesResource.value() : [],
  );

  readonly isLoading = this.spacesResource.isLoading;
  readonly loadError: Signal<Error | undefined> = this.spacesResource.error;

  private readonly _activeSpaceId = signal<string | null>(null);

  /**
   * `null` means "all spaces". An unknown id falls back to it rather than
   * hiding every note.
   */
  readonly activeSpaceId = computed<string | null>(() => this.activeSpace()?.id ?? null);

  readonly activeSpace = computed<Space | null>(() => {
    const activeId = this._activeSpaceId();
    return activeId === null ? null : (this.spaces().find((space) => space.id === activeId) ?? null);
  });

  constructor() {
    // Unlike the notes, a failure here empties no screen: the picker shows "all
    // spaces". Without a banner the breakdown would go unnoticed.
    effect(() => {
      const error = this.loadError();
      if (error) {
        this.notifier.notify({ ref: { key: 'errors.spacesLoadFailed' }, detail: error.message });
      }
    });
  }

  reload(): void {
    this.spacesResource.reload();
  }

  /** `null` selects "all spaces". */
  selectSpace(id: string | null): void {
    this._activeSpaceId.set(id);
  }

  /**
   * Creates a space and makes it active; the id comes from persistence.
   *
   * An empty name is ignored silently. Uniqueness is **not** checked here: only
   * storage sees the real state of the database, and its refusal comes back as
   * a translated code.
   */
  async createSpace(name: string): Promise<Space | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;

    // The typed name is the interpolation fallback when the back end supplies
    // none: "A space named {{name}} already exists" has to stay readable.
    const created = await this.notifier.attempt(
      'errors.spaceCreateFailed',
      () => this.repository.create({ name: trimmed }),
      { name: trimmed },
    );
    if (!created) return null;

    this.spacesResource.set([...this.spaces(), created]);
    this.selectSpace(created.id);
    return created;
  }

  /**
   * The write is not optimistic: the list adopts only what persistence
   * returned. Uniqueness there excludes the renamed space — correcting a name's
   * case is legitimate.
   */
  async renameSpace(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    const current = this.spaces().find((space) => space.id === id);
    if (!trimmed || !current || current.name === trimmed) return false;

    const renamed = await this.notifier.attempt(
      'errors.spaceRenameFailed',
      () => this.repository.rename(id, { name: trimmed }),
      { name: trimmed },
    );
    if (!renamed) return false;

    this.spacesResource.set(this.spaces().map((space) => (space.id === id ? renamed : space)));
    return true;
  }

  /**
   * Deletes a space, moving its notes to `targetSpaceId`, which becomes active:
   * the notes have just landed there, and falling back to "all spaces" would
   * lose sight of where they went.
   */
  async deleteSpace(id: string, targetSpaceId: string): Promise<boolean> {
    // A space cannot be its own refuge: the cascade would take the notes right
    // after the transfer. The back end refuses too; this guard only saves a
    // round trip.
    if (id === targetSpaceId || !this.spaces().some((space) => space.id === targetSpaceId)) {
      return false;
    }

    const deleted = await this.notifier.attempt('errors.spaceDeleteFailed', () =>
      this.repository.delete(id, targetSpaceId),
    );
    if (deleted === null) return false;

    this.spacesResource.set(this.spaces().filter((space) => space.id !== id));
    this.selectSpace(targetSpaceId);
    // The absorbed notes changed `spaceId` in the database, which a query on an
    // unrelated space would not otherwise notice.
    this.revision.bump();
    return true;
  }
}
