import { Injectable, Signal, signal } from '@angular/core';

/**
 * The trash, the tag manager and the library all write notes, and none of them can
 * reload the canvas: injecting `NotesStore` would close an injection cycle. They bump
 * a counter instead, `NotesStore` reads it among its query parameters, and its
 * `resource` re-runs on its own.
 */
@Injectable({ providedIn: 'root' })
export class NotesRevision {
  private readonly counter = signal(0);

  readonly current: Signal<number> = this.counter.asReadonly();

  bump(): void {
    this.counter.update((revision) => revision + 1);
  }
}
