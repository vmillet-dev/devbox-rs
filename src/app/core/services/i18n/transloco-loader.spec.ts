import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_INFO } from '@core/services/app-info/app-info.service';
import en from './translations/en.json';
import fr from './translations/fr.json';
import { AppTranslocoLoader } from './transloco-loader';

describe('AppTranslocoLoader', () => {
  let loader: AppTranslocoLoader;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    loader = TestBed.inject(AppTranslocoLoader);
  });

  it('adds the application name as a key, which is what `{{app}}` resolves to', async () => {
    const translation = await firstValueFrom(loader.getTranslation('fr'));

    expect(translation['app']).toBe(APP_INFO.name);
  });

  it('answers an empty translation for a language it does not bundle', async () => {
    const translation = await firstValueFrom(loader.getTranslation('de'));

    expect(Object.keys(translation)).toEqual(['app']);
  });
});

/** Asserted on the shipped files: no translated string may spell the app's name out. */
describe('the translation files', () => {
  function strings(node: unknown): string[] {
    if (typeof node === 'string') return [node];
    if (node !== null && typeof node === 'object') {
      return Object.values(node).flatMap(strings);
    }
    return [];
  }

  it.each([
    ['fr', fr],
    ['en', en],
  ])('never spells the application name out (%s)', (_locale, translations) => {
    expect(strings(translations).filter((value) => value.includes(APP_INFO.name))).toEqual([]);
  });

  it.each([
    ['fr', fr],
    ['en', en],
  ])('writes {{app}} instead (%s)', (_locale, translations) => {
    expect(strings(translations).some((value) => value.includes('{{app}}'))).toBe(true);
  });
});
