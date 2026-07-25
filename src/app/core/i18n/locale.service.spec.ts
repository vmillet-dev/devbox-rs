import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../../testing/provide-transloco-testing';
import { LocaleService } from './locale.service';

describe('LocaleService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideTranslocoTesting()] });
  });

  it('defaults to French when nothing is stored', () => {
    const service = TestBed.inject(LocaleService);

    expect(service.activeLocale()).toBe('fr');
  });

  it('restores a previously persisted locale on startup', () => {
    localStorage.setItem('devbox.locale', 'en');

    const service = TestBed.inject(LocaleService);

    expect(service.activeLocale()).toBe('en');
  });

  it('ignores an invalid persisted value', () => {
    localStorage.setItem('devbox.locale', 'de');

    const service = TestBed.inject(LocaleService);

    expect(service.activeLocale()).toBe('fr');
  });

  it('sets the active locale and persists the choice', () => {
    const service = TestBed.inject(LocaleService);

    service.setLocale('en');

    expect(service.activeLocale()).toBe('en');
    expect(localStorage.getItem('devbox.locale')).toBe('en');
  });
});
