import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcService } from '@core/ipc/ipc.service';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { TrayLabels, TrayService } from './tray.service';

describe('TrayService', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let service: TrayService;

  /** Labels of the last `sync_tray` call. */
  function lastLabels(): TrayLabels {
    return invoke.mock.calls.at(-1)?.[1].labels;
  }

  beforeEach(() => {
    invoke = vi.fn(async () => undefined);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideTranslocoTesting(), { provide: IpcService, useValue: { invoke } }],
    });
    service = TestBed.inject(TrayService);
  });

  it('pushes the four menu labels, already translated', () => {
    service.start();

    expect(invoke).toHaveBeenCalledWith('sync_tray', { labels: expect.any(Object) });
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
    const before = invoke.mock.calls.length;

    TestBed.inject(TranslocoService).setActiveLang('en');

    expect(invoke.mock.calls.length).toBeGreaterThan(before);
    expect(lastLabels().quit).toBe('Quit DevBox');
  });

  it('stays silent when there is no tray to talk to', async () => {
    // Outside Tauri the bridge is absent; the window is still usable and still
    // closable, so there is nothing to tell the user.
    invoke.mockRejectedValue(new Error('no bridge'));

    expect(() => service.start()).not.toThrow();
    await Promise.resolve();
  });
});
