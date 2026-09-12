import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { NotesRepository } from '../data/notes.repository';
import { TrashedNote } from '../model/note.model';
import { NotesRevision } from './notes-revision';

/**
 * Loaded **when the panel opens** and not continuously: a permanent resource would
 * fire a query on every deletion. It bumps `NotesRevision` rather than reloading the
 * canvas itself.
 */
@Injectable({ providedIn: 'root' })
export class TrashStore {
  private readonly repository = inject(NotesRepository);
  private readonly notifier = inject(ErrorNotifier);
  private readonly revision = inject(NotesRevision);

  private readonly _notes = signal<readonly TrashedNote[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _isOpen = signal(false);

  readonly notes = this._notes.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();
  readonly isEmpty = computed(() => !this._isLoading() && this._notes().length === 0);

  async open(): Promise<void> {
    this._isOpen.set(true);
    await this.load();
  }

  close(): void {
    this._isOpen.set(false);
  }

  /** The back end purges what retention has caught up with **before** answering. */
  async load(): Promise<void> {
    this._isLoading.set(true);
    try {
      this._notes.set(await this.repository.loadTrash());
    } catch (error) {
      this.notifier.reportFailure('errors.trashLoadFailed', error);
    } finally {
      // `finally` rather than `attempt`: the flag brackets the call, and must be
      // cleared even when what follows the await throws.
      this._isLoading.set(false);
    }
  }

  /** `true` when a note came back, which is what bumps the canvas revision. */
  async restore(id: string): Promise<boolean> {
    return this.run(() => this.repository.restore([id]));
  }

  async purge(id: string): Promise<boolean> {
    return this.run(() => this.repository.purge([id]));
  }

  async emptyTrash(): Promise<boolean> {
    return this.run(() => this.repository.emptyTrash());
  }

  private async run(action: () => Promise<number>): Promise<boolean> {
    if ((await this.notifier.attempt('errors.trashActionFailed', action)) === null) return false;

    this.revision.bump();
    await this.load();
    return true;
  }
}
