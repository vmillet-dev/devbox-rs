import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { type MockInstance, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '@core/ipc/bindings';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { TrayLabels, TrayService } from './tray.service';

describe('TrayService', () => {
  // The generated bindings call `invoke` directly, so the command object is what
  // a spec substitutes — there is no injectable seam left to replace.
  let syncTray: MockInstance<typeof commands.syncTray>;
  let service: TrayService;

  /** Labels of the last `sync_tray` call. */
  function lastLabels(): TrayLabels {
    return syncTray.mock.calls.at(-1)![0];
  }

  beforeEach(() => {
    syncTray = vi.spyOn(commands, 'syncTray').mockResolvedValue(undefined);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideTranslocoTesting()] });
    service = TestBed.inject(TrayService);
  });

  it('pushes the four menu labels, already translated', () => {
    service.start();

    expect(syncTray).toHaveBeenCalled();
    // French is the default locale; the native side never holds a string.
    expect(lastLabels()).toEqual({
      open: 'Ouvrir DevBox',
      newNote: 'Nouvelle note',
      capture: 'Coller le presse-papier',
      quit: 'Quitter DevBox',
    });
  });

  it('re-translates the menu when the interface language changes', () => {
    service.start();
    const before = syncTray.mock.calls.length;

    TestBed.inject(TranslocoService).setActiveLang('en');

    expect(syncTray.mock.calls.length).toBeGreaterThan(before);
    expect(lastLabels().quit).toBe('Quit DevBox');
  });

  it('stays silent when there is no tray to talk to', async () => {
    // Outside Tauri the bridge is absent; the window is still usable and still
    // closable, so there is nothing to tell the user.
    syncTray.mockRejectedValue(new Error('no bridge'));

    expect(() => service.start()).not.toThrow();
    await Promise.resolve();
  });
});
