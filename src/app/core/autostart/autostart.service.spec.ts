import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '@core/settings/settings.store';
import { AUTOSTART_ADAPTER, AutostartAdapter, AutostartService } from './autostart.service';

function fakeAdapter(enabled = false) {
  const state = {
    enabled,
    enable: vi.fn(async () => {
      state.enabled = true;
    }),
    disable: vi.fn(async () => {
      state.enabled = false;
    }),
    isEnabled: vi.fn(async () => state.enabled),
  };
  // Vérifie que le double couvre bien la couture, sans figer son type ici :
  // les specs ont besoin des `mock*` de Vitest sur chaque méthode.
  state satisfies AutostartAdapter;

  return state;
}

describe('AutostartService', () => {
  let adapter: ReturnType<typeof fakeAdapter>;
  let service: AutostartService;
  let settings: SettingsStore;

  function setUp(double: ReturnType<typeof fakeAdapter>): void {
    adapter = double;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AUTOSTART_ADAPTER, useValue: adapter }],
    });
    settings = TestBed.inject(SettingsStore);
    service = TestBed.inject(AutostartService);
  }

  beforeEach(() => setUp(fakeAdapter()));

  it('aligns the preference on what the system declares', async () => {
    // L'état réel appartient au système : le désactiver depuis le gestionnaire
    // des tâches doit décocher la case, pas la voir le réactiver.
    setUp(fakeAdapter(true));

    await service.start();

    expect(settings.startWithSystem()).toBe(true);
  });

  it('registers the entry when the preference is turned on', async () => {
    await service.start();

    settings.setStartWithSystem(true);
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.enable).toHaveBeenCalled();
  });

  it('does not rewrite an entry the system already holds', async () => {
    setUp(fakeAdapter(true));

    await service.start();
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.enable).not.toHaveBeenCalled();
  });

  it('removes the entry when the preference is turned off', async () => {
    setUp(fakeAdapter(true));
    await service.start();
    TestBed.tick();

    settings.setStartWithSystem(false);
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.disable).toHaveBeenCalled();
  });

  it('leaves the preference alone when the plugin is unavailable', async () => {
    // C'est le cas hors Tauri, et celui sous lequel tournent les autres specs.
    adapter.isEnabled.mockRejectedValue(new Error('no plugin'));

    await expect(service.start()).resolves.toBeUndefined();
    expect(settings.startWithSystem()).toBe(false);
  });
});
