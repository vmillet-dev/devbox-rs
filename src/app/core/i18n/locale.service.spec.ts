import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesService } from '@core/preferences/preferences.service';
import { provideTranslocoTesting } from '@testing/provide-transloco-testing';
import { LocaleService } from './locale.service';

describe('LocaleService', () => {
  /** Mirrors the app initializer: instantiate, then restore the stored choice. */
  function createService(): LocaleService {
    const service = TestBed.inject(LocaleService);
    service.restore();
    return service;
  }

  /**
   * Persistence is asserted through `PreferencesService`, not through whatever it happens
   * to sit on: the backing store moved without this service changing a line.
   */
  function preferences(): PreferencesService {
    return TestBed.inject(PreferencesService);
  }

  /** jsdom reports `en-US`, which would make every locale assertion depend on the runner. */
  function stubSystemLanguages(...tags: string[]): void {
    Object.defineProperty(navigator, 'languages', { value: tags, configurable: true });
    Object.defineProperty(navigator, 'language', { value: tags[0] ?? '', configurable: true });
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    document.documentElement.lang = '';
    stubSystemLanguages('de-DE');
    TestBed.configureTestingModule({ providers: [provideTranslocoTesting()] });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'languages');
    Reflect.deleteProperty(navigator, 'language');
  });

  it('falls back to French when the system speaks neither language', () => {
    expect(createService().activeLocale()).toBe('fr');
  });

  it('follows the system language when nothing has been chosen', () => {
    stubSystemLanguages('en-GB');

    expect(createService().activeLocale()).toBe('en');
  });

  it('takes the first supported entry of the system list', () => {
    stubSystemLanguages('de-DE', 'en-US', 'fr-FR');

    expect(createService().activeLocale()).toBe('en');
  });

  it('does not persist the detected language, so the app keeps following the system', () => {
    stubSystemLanguages('en-US');

    createService();

    expect(preferences().read('devbox.locale')).toBeNull();
  });

  it('restores a previously persisted locale', () => {
    preferences().write('devbox.locale', 'en');

    expect(createService().activeLocale()).toBe('en');
  });

  it('prefers a stored choice over the system language', () => {
    stubSystemLanguages('en-US');
    preferences().write('devbox.locale', 'fr');

    expect(createService().activeLocale()).toBe('fr');
  });

  it('ignores an invalid persisted value', () => {
    preferences().write('devbox.locale', 'de');

    expect(createService().activeLocale()).toBe('fr');
  });

  it('sets the active locale and persists the choice', () => {
    const service = createService();

    service.setLocale('en');

    expect(service.activeLocale()).toBe('en');
    expect(preferences().read('devbox.locale')).toBe('en');
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
