import { InjectionToken, Injectable, inject } from '@angular/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Events pushed by the native engine.
 *
 * ⚠️ Mirror of the topic constants in `src-tauri/src/desktop.rs`: a typo on
 * either side produces a silently inert subscription that nothing reports.
 */
export type AppEventTopic = 'devbox:capture' | 'devbox:new-note' | 'devbox:palette';

/** Unsubscribes. A no-op when the subscription never landed. */
export type Unlisten = () => void;

export type EventSubscriber = (topic: string, handler: () => void) => Promise<Unlisten>;

export const EVENT_SUBSCRIBER = new InjectionToken<EventSubscriber>('EVENT_SUBSCRIBER', {
  providedIn: 'root',
  factory: () => (topic, handler) => listen(topic, () => handler()),
});

/**
 * The bridge's **downward** direction: the native side notifies, the front
 * reacts. Upward goes through the commands generated in `bindings.ts`.
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
  on(topic: AppEventTopic, handler: () => void): Unlisten {
    let unlisten: Unlisten | null = null;
    let cancelled = false;

    void this.subscribe(topic, handler)
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
