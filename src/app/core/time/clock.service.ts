import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';

/**
 * Cadence de rafraîchissement de l'horloge. 30 s : assez court pour que
 * « à l'instant » devienne « il y a 1 min » sans décalage visible, assez long
 * pour que le réveil périodique du moteur de rendu reste négligeable.
 */
export const CLOCK_TICK_MS = 30_000;

/**
 * Horloge applicative exposée sous forme de signal.
 *
 * Elle existe parce qu'un libellé de temps relatif calculé avec `new Date()`
 * à l'intérieur d'un `computed()` se fige : le `computed` ne dépend d'aucun
 * signal représentant le temps, il ne se réévalue donc jamais tant que la note
 * ne change pas — une carte affiche « il y a 4 min » indéfiniment.
 *
 * Injecter `now()` rend ces `computed()` à la fois **purs** (plus de lecture
 * cachée de l'horloge système) et **auto-rafraîchissants**.
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
