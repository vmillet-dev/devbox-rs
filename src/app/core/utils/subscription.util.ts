/** Unsubscribes. A no-op when the subscription never landed. */
export type Unlisten = () => void;

/**
 * Turns a subscription that only lands on the next turn into one that can be cancelled
 * **now**: without the flag, a caller destroyed before the promise resolves would stay
 * subscribed for the session. Outside Tauri the subscription never lands at all, and the
 * result is inert rather than fatal.
 */
export function subscribeCancellable<T>(subscribe: (handler: T) => Promise<Unlisten>, handler: T): Unlisten {
  let unlisten: Unlisten | null = null;
  let cancelled = false;

  void subscribe(handler)
    .then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
  };
}
