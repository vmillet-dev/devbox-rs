import { AvailableUpdate, DownloadProgress } from '@core/updates/updater.service';

/**
 * Stand-in for `UpdaterService`, which would otherwise reach for the Tauri
 * bridge — absent under jsdom. Substituted by class token, so its shape only has
 * to cover what `UpdateStore` calls.
 */
export class FakeUpdater {
  /** What the next `check()` resolves to. */
  available: AvailableUpdate | null = null;
  checkError: Error | null = null;
  installError: Error | null = null;
  /** Progress values replayed to the callback on `install()`. */
  progressSteps: DownloadProgress[] = [null, 1];

  installCalls = 0;
  relaunched = false;
  discarded = false;

  /** Holds `install()` open so a spec can observe the in-flight state. */
  deferInstall = false;
  private release: (() => void) | null = null;

  async check(): Promise<AvailableUpdate | null> {
    if (this.checkError) throw this.checkError;
    return this.available;
  }

  async install(onProgress: (progress: DownloadProgress) => void): Promise<void> {
    this.installCalls += 1;
    for (const step of this.progressSteps) onProgress(step);

    if (this.deferInstall) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    if (this.installError) throw this.installError;
  }

  finishInstall(): void {
    this.release?.();
    this.release = null;
  }

  async relaunch(): Promise<void> {
    this.relaunched = true;
  }

  async discard(): Promise<void> {
    this.discarded = true;
  }
}
