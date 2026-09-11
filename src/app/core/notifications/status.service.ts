import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';
import { TranslationRef } from '../i18n/translation-ref.model';

/** Long enough to be read, short enough not to sit across the screen. */
export const STATUS_TTL_MS = 6000;

/**
 * Acknowledgements for actions that **succeed**.
 *
 * Separate from `ErrorNotifier`, which carries a breakdown that stays until it
 * is dismissed: mixing the two in one banner would make a success read as a
 * problem.
 *
 * The message is a **translation reference**, never a sentence: the caller does
 * not know the active language.
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
