import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';

/** Assez court pour que « à l'instant » devienne « il y a 1 min » à temps. */
export const CLOCK_TICK_MS = 30_000;

/**
 * Horloge applicative sous forme de signal.
 *
 * ⚠️ Un `new Date()` lu dans un `computed()` le **fige** : il ne dépend alors
 * d'aucun signal représentant le temps et ne se réévalue jamais — une carte
 * afficherait « il y a 4 min » indéfiniment. Injecter `now()` rend ces
 * `computed()` purs et auto-rafraîchissants.
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
