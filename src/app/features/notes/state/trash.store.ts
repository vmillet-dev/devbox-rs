import { Injectable, computed, inject, signal } from '@angular/core';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { NotesRepository } from '../data/notes.repository';
import { TrashedNote } from '../model/note.model';

/**
 * Corbeille. Chargée **à l'ouverture du panneau** et pas en continu : les notes
 * au rebut ne s'affichent nulle part ailleurs, et une ressource permanente
 * relancerait une requête à chaque suppression.
 *
 * Ne recharge pas le canevas : ce store ne connaît pas `NotesStore`, l'inverse
 * serait un cycle d'injection. D'où les booléens renvoyés, que la page enchaîne.
 */
@Injectable({ providedIn: 'root' })
export class TrashStore {
  private readonly repository = inject(NotesRepository);
  private readonly notifier = inject(ErrorNotifier);

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

  /**
   * Le back purge ce que la rétention a rattrapé **avant** de répondre : la
   * corbeille ne montre jamais une note qu'un redémarrage effacerait.
   */
  async load(): Promise<void> {
    this._isLoading.set(true);
    try {
      this._notes.set(await this.repository.loadTrash());
    } catch (error) {
      this.notifier.reportFailure('errors.trashLoadFailed', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  /** `true` quand le canevas doit se recharger : une note lui est revenue. */
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
    try {
      await action();
      await this.load();
      return true;
    } catch (error) {
      this.notifier.reportFailure('errors.trashActionFailed', error);
      return false;
    }
  }
}
