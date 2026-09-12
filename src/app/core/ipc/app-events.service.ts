import { InjectionToken, Injectable, inject } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { Unlisten, subscribeCancellable } from '../utils/subscription.util';
import { GLOBAL_ACTION_EVENT, GlobalAction } from './bindings';

/**
 * **Generated** from `desktop::GlobalAction`, so a variant added in Rust breaks every
 * `switch` that handles it here.
 */
export type { GlobalAction };

export type EventSubscriber = (handler: (action: GlobalAction) => void) => Promise<Unlisten>;

export const EVENT_SUBSCRIBER = new InjectionToken<EventSubscriber>('EVENT_SUBSCRIBER', {
  providedIn: 'root',
  factory: () => (handler) => listen<GlobalAction>(GLOBAL_ACTION_EVENT, (event) => handler(event.payload)),
});

/**
 * The bridge's **downward** direction: the native side notifies, the front reacts.
 * Upward goes through the commands generated in `bindings.ts`.
 *
 * One topic carrying a closed action, not one topic per action: the topic strings used to
 * be spelled on both sides, where a typo produced a subscription that was silently inert.
 * Outside Tauri (jsdom) `listen` fails, and the subscription is inert rather than fatal.
 */
@Injectable({ providedIn: 'root' })
export class AppEventsService {
  private readonly subscribe = inject(EVENT_SUBSCRIBER);

  on(handler: (action: GlobalAction) => void): Unlisten {
    return subscribeCancellable(this.subscribe, handler);
  }
}
