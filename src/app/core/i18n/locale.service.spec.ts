import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { LocaleService } from './locale.service';

describe('LocaleService', () => {
  /** Mirrors the app initializer: instantiate, then restore the stored choice. */
  function createService(): LocaleService {
    const service = TestBed.inject(LocaleService);
    service.restore();
    return service;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    document.documentElement.lang = '';
    TestBed.configureTestingModule({ providers: [provideTranslocoTesting()] });
  });

  it('defaults to French when nothing is stored', () => {
    expect(createService().activeLocale()).toBe('fr');
  });

  it('restores a previously persisted locale', () => {
    localStorage.setItem('devbox.locale', 'en');

    expect(createService().activeLocale()).toBe('en');
  });

  it('ignores an invalid persisted value', () => {
    localStorage.setItem('devbox.locale', 'de');

    expect(createService().activeLocale()).toBe('fr');
  });

  it('sets the active locale and persists the choice', () => {
    const service = createService();

    service.setLocale('en');

    expect(service.activeLocale()).toBe('en');
    expect(localStorage.getItem('devbox.locale')).toBe('en');
  });

  it('keeps the document language in sync, which drives screen-reader pronunciation', () => {
    const service = createService();
    TestBed.tick();
    expect(document.documentElement.lang).toBe('fr');

    service.setLocale('en');
    TestBed.tick();

    expect(document.documentElement.lang).toBe('en');
  });
});
