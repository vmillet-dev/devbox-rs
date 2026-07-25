import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
  let service: PreferencesService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    service = TestBed.inject(PreferencesService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a value', () => {
    service.write('devbox.test', 'value');

    expect(service.read('devbox.test')).toBe('value');
  });

  it('returns null for an unknown key', () => {
    expect(service.read('devbox.unknown')).toBeNull();
  });

  it('returns null instead of throwing when storage is unavailable', () => {
    // Private-browsing WebViews throw on access; a preference must never take
    // the application down with it.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    expect(service.read('devbox.test')).toBeNull();
  });

  it('swallows write failures such as an exceeded quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => service.write('devbox.test', 'value')).not.toThrow();
  });
});
