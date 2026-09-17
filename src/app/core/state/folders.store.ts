import { Injectable, Signal, computed, effect, inject, resource, signal } from '@angular/core';
import { ErrorNotifier } from '@core/services/errors/error-notifier.service';
import { FoldersRepository } from '../data/folders.repository';
import { Folder, FolderColour } from '../model/folder.model';
import { NotesRevision } from './notes-revision';
import { SpacesStore } from './spaces.store';

/**
 * The folders of the active space, and which one narrows the canvas.
 *
 * ⚠️ `null` on both counts is a choice, not a waiting state: no active space means the
 * user asked for all of them, and no active folder means every note, filed or not.
 */
@Injectable({ providedIn: 'root' })
export class FoldersStore {
  private readonly repository = inject(FoldersRepository);
  private readonly notifier = inject(ErrorNotifier);
  private readonly revision = inject(NotesRevision);
  private readonly spaces = inject(SpacesStore);

  private readonly foldersResource = resource({
    params: () => ({ spaceId: this.spaces.activeSpaceId() }),
    loader: ({ params }) => this.repository.loadAll(params.spaceId),
    defaultValue: [] as readonly Folder[],
  });

  readonly folders = computed<readonly Folder[]>(() =>
    this.foldersResource.hasValue() ? this.foldersResource.value() : [],
  );

  readonly isLoading = this.foldersResource.isLoading;
  readonly loadError: Signal<Error | undefined> = this.foldersResource.error;

  private readonly _activeFolderId = signal<string | null>(null);

  /** An id the current space does not hold falls back to "every folder". */
  readonly activeFolderId = computed<string | null>(() => this.activeFolder()?.id ?? null);

  readonly activeFolder = computed<Folder | null>(() => {
    const activeId = this._activeFolderId();
    return activeId === null ? null : (this.folders().find((folder) => folder.id === activeId) ?? null);
  });

  constructor() {
    // A failure here empties no screen, so without a banner it would go unnoticed.
    effect(() => {
      const error = this.loadError();
      if (error) {
        this.notifier.notify({ ref: { key: 'errors.foldersLoadFailed' }, detail: error.message });
      }
    });
  }

  reload(): void {
    this.foldersResource.reload();
  }

  selectFolder(id: string | null): void {
    this._activeFolderId.set(id);
  }

  /** Uniqueness is not checked here: only storage sees the real state of the database. */
  async createFolder(name: string): Promise<Folder | null> {
    const trimmed = name.trim();
    const spaceId = this.spaces.activeSpaceId();
    if (!trimmed || spaceId === null) return null;

    const created = await this.notifier.attempt(
      'errors.folderCreateFailed',
      () => this.repository.create({ spaceId, name: trimmed }),
      { name: trimmed },
    );
    if (!created) return null;

    this.foldersResource.set([...this.folders(), created]);
    return created;
  }

  /** Not optimistic: the list adopts only what persistence returned. */
  async renameFolder(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    const current = this.folders().find((folder) => folder.id === id);
    if (!trimmed || !current || current.name === trimmed) return false;

    const renamed = await this.notifier.attempt(
      'errors.folderRenameFailed',
      () => this.repository.rename(id, trimmed),
      { name: trimmed },
    );
    if (!renamed) return false;

    this.adopt(renamed);
    // The chips on the cards carry the name, and the back end resolved them.
    this.revision.bump();
    return true;
  }

  async recolourFolder(id: string, colour: FolderColour): Promise<boolean> {
    const recoloured = await this.notifier.attempt('errors.folderRecolourFailed', () =>
      this.repository.recolour(id, colour),
    );
    if (!recoloured) return false;

    this.adopt(recoloured);
    this.revision.bump();
    return true;
  }

  /** ⚠️ No refuge to choose: the notes stay where they are and come out loose. */
  async deleteFolder(id: string): Promise<boolean> {
    const deleted = await this.notifier.attempt('errors.folderDeleteFailed', () =>
      this.repository.delete(id),
    );
    if (deleted === null) return false;

    this.foldersResource.set(this.folders().filter((folder) => folder.id !== id));
    if (this._activeFolderId() === id) {
      this.selectFolder(null);
    }
    // Its notes lost their chip, which nothing else would tell the canvas.
    this.revision.bump();
    return true;
  }

  private adopt(folder: Folder): void {
    this.foldersResource.set(this.folders().map((current) => (current.id === folder.id ? folder : current)));
  }
}
