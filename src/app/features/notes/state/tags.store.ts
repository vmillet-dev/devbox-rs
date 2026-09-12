import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { NotesRepository } from '../data/notes.repository';
import { TagUsage } from '../model/note.model';
import { NotesRevision } from './notes-revision';

/**
 * Scoped to the **whole corpus** and not to the active space: a tag that drifts (`auth`,
 * `authentication`, `Auth`) drifts everywhere, and mending it in one space would leave
 * the other half in place.
 */
@Injectable({ providedIn: 'root' })
export class TagsStore {
  private readonly repository = inject(NotesRepository);
  private readonly notifier = inject(ErrorNotifier);
  private readonly revision = inject(NotesRevision);

  private readonly _tags = signal<readonly TagUsage[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _isOpen = signal(false);
  private readonly _selected = signal<ReadonlySet<string>>(new Set());

  readonly tags = this._tags.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();
  readonly selected = this._selected.asReadonly();
  readonly isEmpty = computed(() => !this._isLoading() && this._tags().length === 0);

  /** A merge needs at least two tags; a rename exactly one. */
  readonly selectedCount = computed(() => this._selected().size);

  async open(): Promise<void> {
    this._isOpen.set(true);
    this._selected.set(new Set());
    await this.load();
  }

  close(): void {
    this._isOpen.set(false);
  }

  async load(): Promise<void> {
    this._isLoading.set(true);
    try {
      this._tags.set(await this.repository.loadTags());
    } catch (error) {
      this.notifier.reportFailure('errors.tagsLoadFailed', error);
    } finally {
      // See `TrashStore.load`: a bracketing flag wants `finally`.
      this._isLoading.set(false);
    }
  }

  toggle(tag: string): void {
    this._selected.update((selection) => {
      const next = new Set(selection);
      if (!next.delete(tag)) {
        next.add(tag);
      }
      return next;
    });
  }

  /** Renaming onto an existing tag **is** a merge: a note cannot carry one twice. */
  async renameSelected(into: string): Promise<boolean> {
    const selection = [...this._selected()];
    if (selection.length === 0 || !into.trim()) return false;

    const [only] = selection;

    return this.run(() =>
      only !== undefined && selection.length === 1
        ? this.repository.renameTag(only, into)
        : this.repository.mergeTags(selection, into),
    );
  }

  async deleteSelected(): Promise<boolean> {
    const selection = [...this._selected()];
    if (selection.length === 0) return false;

    return this.run(() => this.repository.deleteTags(selection));
  }

  private async run(action: () => Promise<number>): Promise<boolean> {
    if ((await this.notifier.attempt('errors.tagActionFailed', action)) === null) return false;

    // Retagging rewrites the corpus: the rail and the cards are both stale.
    this.revision.bump();
    this._selected.set(new Set());
    await this.load();
    return true;
  }
}
