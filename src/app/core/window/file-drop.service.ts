import { InjectionToken, Injectable, inject } from '@angular/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

/** Se désabonne. Rien à faire si l'abonnement n'a jamais abouti. */
export type Unlisten = () => void;

export type FileDropSubscriber = (handler: (paths: readonly string[]) => void) => Promise<Unlisten>;

/**
 * Le glisser-déposer est un événement **de la fenêtre**, pas du DOM : la WebView
 * ne voit pas passer les fichiers, c'est le natif qui les annonce avec leurs
 * chemins. Un `dragover`/`drop` HTML ne recevrait rien.
 */
export const FILE_DROP_SUBSCRIBER = new InjectionToken<FileDropSubscriber>('FILE_DROP_SUBSCRIBER', {
  providedIn: 'root',
  factory: () => async (handler) =>
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        handler(event.payload.paths);
      }
    }),
});

/**
 * Fichiers déposés sur la fenêtre.
 *
 * Même forme que `AppEventsService` : le désabonnement est rendu tout de suite
 * alors que l'abonnement n'aboutit qu'au tour suivant, sans quoi un composant
 * détruit entre les deux resterait abonné pour la session. Hors Tauri l'appel
 * échoue et l'abonnement est simplement inerte.
 */
@Injectable({ providedIn: 'root' })
export class FileDropService {
  private readonly subscribe = inject(FILE_DROP_SUBSCRIBER);

  on(handler: (paths: readonly string[]) => void): Unlisten {
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
