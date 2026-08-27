import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';
import { TranslationRef } from '../i18n/translation-ref.model';

/** Assez pour être lu, assez court pour ne pas rester en travers de l'écran. */
export const STATUS_TTL_MS = 6000;

/**
 * Accusés de réception des actions qui **réussissent**.
 *
 * Séparé d'`ErrorNotifier` : celui-ci porte une panne, qui reste tant qu'on ne
 * la masque pas, et mélanger les deux dans un même bandeau ferait passer un
 * succès pour un problème.
 *
 * Le message est une **référence de traduction**, jamais une phrase : l'appelant
 * ne connaît pas la langue active.
 */
@Injectable({ providedIn: 'root' })
export class StatusNotifier {
  private readonly _status = signal<TranslationRef | null>(null);

  readonly status: Signal<TranslationRef | null> = this._status.asReadonly();

  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  notify(ref: TranslationRef): void {
    this.cancel();
    this._status.set(ref);
    this.timeout = setTimeout(() => {
      this.timeout = null;
      this._status.set(null);
    }, STATUS_TTL_MS);
  }

  dismiss(): void {
    this.cancel();
    this._status.set(null);
  }

  private cancel(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
