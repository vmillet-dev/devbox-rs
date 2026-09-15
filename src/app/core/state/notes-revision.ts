import { Injectable, Signal, signal } from '@angular/core';

/**
 * A store that writes notes without knowing `NotesStore` — injecting it would close a
 * cycle — bumps this instead. `NotesQueryStore` reads it among its query parameters, so
 * its `resource` re-runs on its own and nothing reloads the canvas by hand.
 */
@Injectable({ providedIn: 'root' })
export class NotesRevision {
  private readonly counter = signal(0);

  readonly current: Signal<number> = this.counter.asReadonly();

  bump(): void {
    this.counter.update((revision) => revision + 1);
  }
}
