import { ErrorHandler, Injectable, inject } from '@angular/core';
import { IpcError } from '../ipc/ipc.error';
import { ErrorNotifier, errorDetail } from './error-notifier.service';

/**
 * The last net: every uncaught exception is logged **and** put on screen. IPC
 * failures get their own message — that is the expected failure mode in
 * production, and it deserves better than "an error occurred".
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
