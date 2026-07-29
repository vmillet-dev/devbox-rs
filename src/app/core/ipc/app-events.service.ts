import { InjectionToken, Injectable, inject } from '@angular/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Événements poussés par le moteur natif. Miroir de `mod events` dans
 * `src-tauri/src/lib.rs` : une faute de frappe d'un côté produit un abonnement
 * silencieusement inerte, que rien ne signale.
 */
export type AppEventTopic = 'devbox:capture' | 'devbox:new-note';

/** Se désabonne. Rien à faire si l'abonnement n'a jamais abouti. */
export type Unlisten = () => void;

export type EventSubscriber = (topic: string, handler: () => void) => Promise<Unlisten>;

export const EVENT_SUBSCRIBER = new InjectionToken<EventSubscriber>('EVENT_SUBSCRIBER', {
  providedIn: 'root',
  factory: () => (topic, handler) => listen(topic, () => handler()),
});

/**
 * Sens **descendant** du pont : le natif prévient, le front réagit. `IpcService`
 * garde le sens montant et reste l'unique appelant d'`invoke()`.
 *
 * Hors Tauri (jsdom), `listen` échoue : l'abonnement est alors inerte plutôt que
 * fatal, comme pour les préférences et le presse-papier.
 */
@Injectable({ providedIn: 'root' })
export class AppEventsService {
  private readonly subscribe = inject(EVENT_SUBSCRIBER);

  /**
   * Rend de quoi se désabonner **immédiatement**, alors que l'abonnement lui
   * n'est acquis qu'au tour suivant : sans le drapeau, un composant détruit
   * avant la résolution resterait abonné pour la durée de la session.
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
