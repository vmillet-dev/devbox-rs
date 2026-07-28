import { Signal, signal } from '@angular/core';

/**
 * Stand-in for `AppInfoService`. The real one calls `getVersion()` eagerly from
 * a `resource`, which needs the Tauri bridge jsdom does not have — every spec
 * mounting the titlebar would otherwise log a failed resource.
 */
export class FakeAppInfo {
  /** Writable here so a spec can flip it to `null` and assert the fallback. */
  readonly versionSignal = signal<string | null>('0.1.0');
  readonly version: Signal<string | null> = this.versionSignal.asReadonly();

  openedRepository = 0;
  openError: Error | null = null;

  async openRepository(): Promise<void> {
    this.openedRepository += 1;
    if (this.openError) throw this.openError;
  }
}
