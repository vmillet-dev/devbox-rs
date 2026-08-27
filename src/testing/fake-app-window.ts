import { AppWindowAdapter } from '@core/window/app-window.service';

/**
 * Stand-in for the native window. Substituted in every spec: a real `exit()`
 * would take the test runner down with the application.
 */
export class FakeAppWindow implements AppWindowAdapter {
  hidden = 0;
  exitedWith: number | null = null;

  throwOnHide: Error | null = null;
  throwOnExit: Error | null = null;

  async hide(): Promise<void> {
    if (this.throwOnHide) throw this.throwOnHide;
    this.hidden += 1;
  }

  async exit(code: number): Promise<void> {
    if (this.throwOnExit) throw this.throwOnExit;
    this.exitedWith = code;
  }
}
