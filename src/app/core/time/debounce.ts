import { DestroyRef, inject } from '@angular/core';

/** Filtering crosses the IPC bridge: one call per keystroke would be wasted. */
export const SEARCH_DEBOUNCE_MS = 150;

/** A deferred call, and the means to give up on it. */
export interface Debounced<T> {
  (value: T): void;
  /** Drops a call still waiting. The next one starts a fresh delay. */
  cancel(): void;
}

/**
 * Runs `action` once the calls stop for `delayMs`.
 *
 * Must be built in an injection context: the pending timer is cleared on
 * destruction, which is what a hand-rolled `setTimeout` in a store has to
 * remember to do.
 */
export function debounced<T>(action: (value: T) => void, delayMs: number): Debounced<T> {
  const destroyRef = inject(DestroyRef);
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  destroyRef.onDestroy(cancel);

  const schedule = (value: T): void => {
    cancel();
    timeout = setTimeout(() => {
      timeout = null;
      action(value);
    }, delayMs);
  };

  return Object.assign(schedule, { cancel });
}
