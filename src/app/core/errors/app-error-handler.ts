import { ErrorHandler, Injectable, inject } from '@angular/core';
import { IpcError } from '../ipc/ipc-error';
import { ErrorNotifier, errorDetail } from './error-notifier.service';

/**
 * Dernier filet : toute exception non rattrapée est journalisée **et** portée à
 * l'écran. Les échecs d'IPC reçoivent leur propre message — c'est le mode de
 * panne attendu en production, il mérite mieux qu'un « erreur est survenue ».
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

    this.notifier.notify({ ref: { key: 'errors.unexpected' }, detail: errorDetail(error) });
  }
}
