import { InjectionToken, Injectable, inject } from '@angular/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

/** Unsubscribes. A no-op when the subscription never landed. */
export type Unlisten = () => void;

export type FileDropSubscriber = (handler: (paths: readonly string[]) => void) => Promise<Unlisten>;

/**
 * ⚠️ Drag and drop is a **window** event, not a DOM one: the WebView never sees
 * the files, the native side announces them with their paths. An HTML
 * `dragover`/`drop` would receive nothing.
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
 * Same shape as `AppEventsService`: the unsubscribe is handed back at once where the
 * subscription only lands on the next turn, otherwise a component destroyed in between
 * would stay subscribed for the session. Outside Tauri the subscription is simply inert.
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
