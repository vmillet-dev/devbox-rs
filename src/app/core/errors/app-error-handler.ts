import { ErrorHandler, Injectable, inject } from '@angular/core';
import { IpcError } from '../ipc/ipc.service';
import { ErrorNotifier } from './error-notifier.service';

/**
 * Dernier filet de sécurité : toute exception non rattrapée est journalisée
 * *et* portée à l'écran via `ErrorNotifier`.
 *
 * Les échecs d'IPC reçoivent leur propre message : c'est le mode de panne
 * attendu en production (backend indisponible, commande non enregistrée), et
 * il mérite mieux qu'un « une erreur est survenue » générique.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly notifier = inject(ErrorNotifier);

  handleError(error: unknown): void {
    console.error(error);

    if (error instanceof IpcError) {
      this.notifier.notify({
        ref: { key: 'errors.ipcFailed', params: { command: error.command } },
        detail: error.message,
      });
      return;
    }

    this.notifier.notify({
      ref: { key: 'errors.unexpected' },
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
