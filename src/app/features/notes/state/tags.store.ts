import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { NotesRepository } from '../data/notes.repository';
import { TagUsage } from '../model/note.model';

/**
 * Gestion globale des tags : renommer, fusionner, retirer du corpus.
 *
 * Portée **au corpus entier**, pas à l'espace actif — un tag qui dérive
 * (`auth`, `authentication`, `Auth`) dérive partout, et ne le recoller que dans
 * un espace laisserait l'autre moitié en place.
 *
 * Comme `TrashStore`, ne recharge pas le canevas et renvoie un booléen.
 */
@Injectable({ providedIn: 'root' })
export class TagsStore {
  private readonly repository = inject(NotesRepository);
  private readonly notifier = inject(ErrorNotifier);

  private readonly _tags = signal<readonly TagUsage[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _isOpen = signal(false);
  private readonly _selected = signal<ReadonlySet<string>>(new Set());

  readonly tags = this._tags.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();
  readonly selected = this._selected.asReadonly();
  readonly isEmpty = computed(() => !this._isLoading() && this._tags().length === 0);

  /** Une fusion demande au moins deux tags ; un renommage exactement un. */
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

  /**
   * Renommer vers un tag existant **est** une fusion : la base ne peut pas
   * porter deux fois le même tag sur une note. Le libellé du bouton le dit.
   */
  async renameSelected(into: string): Promise<boolean> {
    const selection = [...this._selected()];
    if (selection.length === 0 || !into.trim()) return false;

    return this.run(() =>
      selection.length === 1
        ? this.repository.renameTag(selection[0], into)
        : this.repository.mergeTags(selection, into),
    );
  }

  async deleteSelected(): Promise<boolean> {
    const selection = [...this._selected()];
    if (selection.length === 0) return false;

    return this.run(async () => {
      for (const tag of selection) {
        await this.repository.deleteTag(tag);
      }
      return selection.length;
    });
  }

  private async run(action: () => Promise<number>): Promise<boolean> {
    try {
      await action();
      this._selected.set(new Set());
      await this.load();
      return true;
    } catch (error) {
      this.notifier.reportFailure('errors.tagActionFailed', error);
      return false;
    }
  }
}
