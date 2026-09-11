import { InjectionToken, Injectable, inject } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { GLOBAL_ACTION_EVENT, GlobalAction } from './bindings';

/**
 * What the native side can ask for. **Generated** from `desktop::GlobalAction`,
 * so a variant added in Rust breaks every `switch` that handles it here.
 */
export type { GlobalAction };

/** Unsubscribes. A no-op when the subscription never landed. */
export type Unlisten = () => void;

export type EventSubscriber = (handler: (action: GlobalAction) => void) => Promise<Unlisten>;

export const EVENT_SUBSCRIBER = new InjectionToken<EventSubscriber>('EVENT_SUBSCRIBER', {
  providedIn: 'root',
  factory: () => (handler) => listen<GlobalAction>(GLOBAL_ACTION_EVENT, (event) => handler(event.payload)),
});

/**
 * The bridge's **downward** direction: the native side notifies, the front
 * reacts. Upward goes through the commands generated in `bindings.ts`.
 *
 * One topic carrying a closed action, not one topic per action: the three topic
 * strings used to be spelled on both sides, where a typo produced a
 * subscription that was silently inert and that nothing reported. Both the
 * topic and the action set are generated now.
 *
 * Outside Tauri (jsdom) `listen` fails, and the subscription is then inert
 * rather than fatal — as for the preferences and the clipboard.
 */
@Injectable({ providedIn: 'root' })
export class AppEventsService {
  private readonly subscribe = inject(EVENT_SUBSCRIBER);

  /**
   * Hands back an unsubscribe **immediately**, where the subscription itself is
   * only acquired on the next turn: without the flag, a component destroyed
   * before it resolves would stay subscribed for the session.
   */
  on(handler: (action: GlobalAction) => void): Unlisten {
    let unlisten: Unlisten | null = null;
    let cancelled = false;

    void this.subscribe(handler)
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
}
