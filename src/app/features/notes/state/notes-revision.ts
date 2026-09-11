import { Injectable, Signal, signal } from '@angular/core';

/**
 * Says that the notes on disk have changed, without knowing who changed them.
 *
 * The trash, the tag manager and the library all write notes, and none of them
 * can reload the canvas: injecting `NotesStore` from there would close an
 * injection cycle. They used to return a boolean the page had to remember to
 * act on — seven call sites, and nothing to catch the eighth writer who forgot.
 *
 * Here they bump a counter instead, `NotesStore` reads it among its query
 * parameters, and its `resource` re-runs on its own.
 */
@Injectable({ providedIn: 'root' })
export class NotesRevision {
  private readonly counter = signal(0);

  readonly current: Signal<number> = this.counter.asReadonly();

  /** The notes changed under us: whoever displays them should read again. */
  bump(): void {
    this.counter.update((revision) => revision + 1);
  }
}
