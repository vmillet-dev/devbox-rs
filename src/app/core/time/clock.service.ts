import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';

/** Short enough for "just now" to become "1 min ago" in time. */
export const CLOCK_TICK_MS = 30_000;

/**
 * ⚠️ A `new Date()` read inside a `computed()` **freezes** it: it then depends on no
 * signal representing time and never re-evaluates — a card would show "4 min ago" forever.
 * Injecting `now()` makes those computeds pure and self-refreshing.
 */
@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly _now = signal(new Date());

  readonly now: Signal<Date> = this._now.asReadonly();

  constructor() {
    const intervalId = setInterval(() => this._now.set(new Date()), CLOCK_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(intervalId));
  }
}
