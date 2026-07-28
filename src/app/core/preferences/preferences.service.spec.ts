import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCES_STORE_LOADER, PreferencesService } from './preferences.service';

/** Minimal stand-in for the plugin's `Store`: only what the service touches. */
function fakeStore(initial: [string, unknown][] = []) {
  const entries = new Map<string, unknown>(initial);
  return {
    entries: vi.fn(async () => [...entries.entries()]),
    set: vi.fn(async (key: string, value: unknown) => {
      entries.set(key, value);
    }),
    written: entries,
  };
}

describe('PreferencesService', () => {
  const loadMock = vi.fn();
  let service: PreferencesService;

  beforeEach(() => {
    localStorage.clear();
    loadMock.mockReset();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PREFERENCES_STORE_LOADER, useValue: loadMock }],
    });
    service = TestBed.inject(PreferencesService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a value through the in-memory cache', async () => {
    loadMock.mockResolvedValue(fakeStore());
    await service.hydrate();

    service.write('devbox.test', 'value');

    expect(service.read('devbox.test')).toBe('value');
  });

  it('returns null for an unknown key', () => {
    expect(service.read('devbox.unknown')).toBeNull();
  });

  it('serves values the store held on disk', async () => {
    loadMock.mockResolvedValue(fakeStore([['devbox.locale', 'en']]));

    await service.hydrate();

    // Reads are synchronous by design: the editor and the locale both read at
    // construction time, before any promise could have settled.
    expect(service.read('devbox.locale')).toBe('en');
  });

  it('pushes a written value to the store', async () => {
    const store = fakeStore();
    loadMock.mockResolvedValue(store);
    await service.hydrate();

    service.write('devbox.locale', 'en');

    expect(store.set).toHaveBeenCalledWith('devbox.locale', 'en');
  });

  it('ignores non-string values rather than surfacing them as strings', async () => {
    loadMock.mockResolvedValue(fakeStore([['devbox.weird', { nested: true }]]));

    await service.hydrate();

    expect(service.read('devbox.weird')).toBeNull();
  });

  it('adopts preferences left in localStorage by an earlier version', async () => {
    localStorage.setItem('devbox.locale', 'en');
    const store = fakeStore();
    loadMock.mockResolvedValue(store);

    await service.hydrate();

    // Without this, updating the app would silently reset the interface language.
    expect(service.read('devbox.locale')).toBe('en');
    expect(store.set).toHaveBeenCalledWith('devbox.locale', 'en');
    // The old location is cleared so a stale value cannot come back later.
    expect(localStorage.getItem('devbox.locale')).toBeNull();
  });

  it('lets the stored file win over a leftover localStorage value', async () => {
    localStorage.setItem('devbox.locale', 'fr');
    loadMock.mockResolvedValue(fakeStore([['devbox.locale', 'en']]));

    await service.hydrate();

    expect(service.read('devbox.locale')).toBe('en');
  });

  it('leaves foreign localStorage keys alone', async () => {
    localStorage.setItem('unrelated', 'keep me');
    const store = fakeStore();
    loadMock.mockResolvedValue(store);

    await service.hydrate();

    expect(store.set).not.toHaveBeenCalled();
    expect(localStorage.getItem('unrelated')).toBe('keep me');
  });

  it('degrades to an in-memory cache when the plugin is unavailable', async () => {
    // This is the case outside Tauri, and the one every other spec runs under.
    loadMock.mockRejectedValue(new Error('plugin not found'));

    await expect(service.hydrate()).resolves.toBeUndefined();

    service.write('devbox.test', 'value');
    expect(service.read('devbox.test')).toBe('value');
  });

  it('does not reject when the store refuses a write', async () => {
    const store = fakeStore();
    store.set.mockRejectedValue(new Error('disk full'));
    loadMock.mockResolvedValue(store);
    await service.hydrate();

    // The write is fire-and-forget: a failed one must not surface as an
    // unhandled rejection, and the session must keep the value anyway.
    expect(() => service.write('devbox.test', 'value')).not.toThrow();
    expect(service.read('devbox.test')).toBe('value');
  });
});
