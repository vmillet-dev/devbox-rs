import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadProgress, UpdaterService } from './updater.service';

/**
 * `check()` and `relaunch()` are one-line calls into the plugin and are left to the
 * application to exercise: `vi.mock` on a Tauri package is unreliable here. What is worth
 * pinning is what the service decides — the download arithmetic and the lifetime of the
 * native handle — and none of it goes near the bridge.
 */

/** Download event as the plugin emits it, reduced to the fields that are read. */
type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

/**
 * Stand-in for the plugin's `Update`, a **native resource**: it carries an id on the Rust
 * side and has to be closed when it is not installed.
 */
function fakeUpdate(events: DownloadEvent[] = []) {
  return {
    closed: 0,
    downloadAndInstall: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
      for (const event of events) onEvent(event);
    }),
    close: vi.fn(async function (this: { closed: number }) {
      this.closed += 1;
    }),
  };
}

describe('UpdaterService', () => {
  let service: UpdaterService;

  /** The handle a `check()` would have retained, which the spec cannot go through. */
  function retain(update: ReturnType<typeof fakeUpdate>): void {
    (service as unknown as { pending: unknown }).pending = update;
  }

  beforeEach(() => {
    service = new UpdaterService();
  });

  it('refuses to install what no check has retained', async () => {
    await expect(service.install(() => undefined)).rejects.toThrow();
  });

  it('turns the download events into a fraction of the total', async () => {
    retain(
      fakeUpdate([
        { event: 'Started', data: { contentLength: 400 } },
        { event: 'Progress', data: { chunkLength: 100 } },
        { event: 'Progress', data: { chunkLength: 100 } },
        { event: 'Finished' },
      ]),
    );
    const progress: DownloadProgress[] = [];

    await service.install((value) => progress.push(value));

    expect(progress).toEqual([null, 0.25, 0.5, 1]);
  });

  it('leaves the progress undetermined when the server announces no size', async () => {
    retain(
      fakeUpdate([
        { event: 'Started', data: {} },
        { event: 'Progress', data: { chunkLength: 100 } },
      ]),
    );
    const progress: DownloadProgress[] = [];

    await service.install((value) => progress.push(value));

    expect(progress).toEqual([null, null]);
  });

  it('reports no progress at all for a download that never starts', async () => {
    retain(fakeUpdate());
    const progress: DownloadProgress[] = [];

    await service.install((value) => progress.push(value));

    expect(progress).toEqual([]);
  });

  it('lets go of the update once it is installed', async () => {
    retain(fakeUpdate([{ event: 'Finished' }]));
    await service.install(() => undefined);

    await expect(service.install(() => undefined)).rejects.toThrow();
  });

  it('closes the update without installing it when it is discarded', async () => {
    const update = fakeUpdate();
    retain(update);

    await service.discard();

    expect(update.closed).toBe(1);
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it('has nothing to close when no update is pending', async () => {
    const update = fakeUpdate();
    retain(update);
    await service.discard();

    await expect(service.discard()).resolves.toBeUndefined();
    expect(update.closed).toBe(1);
  });
});
