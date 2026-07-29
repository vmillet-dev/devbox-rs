import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { IpcService } from '@core/ipc/ipc.service';

/**
 * Libellés du menu de la barre système, **déjà traduits**. Le natif n'écrit
 * aucun texte visible : la langue est une préférence du front, et une table de
 * traductions en Rust serait une seconde source à tenir en phase.
 */
export interface TrayLabels {
  readonly open: string;
  readonly newNote: string;
  readonly capture: string;
  readonly quit: string;
}

const LABEL_KEYS = ['tray.open', 'tray.newNote', 'tray.capture', 'tray.quit'];

/**
 * Icône de la zone de notification : DevBox y reste résidente, à portée des
 * raccourcis globaux, et la croix de la fenêtre ne fait plus que la cacher.
 *
 * C'est ce service qui la **crée**, pas le démarrage natif : sans libellés il
 * n'y aurait rien à afficher. Le menu se retraduit ensuite tout seul, la
 * souscription réémettant à chaque changement de langue.
 *
 * Les actions, elles, ne passent pas par ici — le menu émet les mêmes
 * `devbox:new-note` et `devbox:capture` que les raccourcis globaux, déjà écoutés
 * par `NotesPageComponent`.
 */
@Injectable({ providedIn: 'root' })
export class TrayService {
  private readonly ipc = inject(IpcService);
  private readonly transloco = inject(TranslocoService);

  start(): void {
    this.transloco.selectTranslate<string[]>(LABEL_KEYS).subscribe(([open, newNote, capture, quit]) => {
      void this.push({ open, newNote, capture, quit });
    });
  }

  /**
   * Un échec ne remonte pas : hors Tauri (jsdom) le pont est absent, et sur un
   * bureau sans zone de notification le natif refuse déjà silencieusement. Dans
   * les deux cas la fenêtre reste utilisable et fermable — il n'y a rien à
   * demander à l'utilisateur.
   */
  private async push(labels: TrayLabels): Promise<void> {
    try {
      await this.ipc.invoke('sync_tray', { labels });
    } catch {
      // Sans barre système, l'application vit dans sa fenêtre.
    }
  }
}
