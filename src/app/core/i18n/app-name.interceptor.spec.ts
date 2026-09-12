import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_INFO } from '@core/app-info/app-info.service';
import en from './translations/en.json';
import fr from './translations/fr.json';
import { APP_NAME_TOKEN, AppNameInterceptor } from './app-name.interceptor';

describe('AppNameInterceptor', () => {
  let interceptor: AppNameInterceptor;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    interceptor = TestBed.inject(AppNameInterceptor);
  });

  it('substitutes the token in a flat translation, which is the shape Transloco saves', () => {
    const saved = interceptor.preSaveTranslation({ 'file.quit': `Quitter ${APP_NAME_TOKEN}` });

    expect(saved['file.quit']).toBe(`Quitter ${APP_INFO.name}`);
  });

  it('walks a nested translation too, rather than depending on which shape arrives', () => {
    const saved = interceptor.preSaveTranslation({
      tray: { open: `Ouvrir ${APP_NAME_TOKEN}`, quit: `Quitter ${APP_NAME_TOKEN}` },
    });

    expect(saved['tray']).toEqual({
      open: `Ouvrir ${APP_INFO.name}`,
      quit: `Quitter ${APP_INFO.name}`,
    });
  });

  it('leaves an interpolation for the pipe to fill', () => {
    const saved = interceptor.preSaveTranslation({
      summary: `${APP_NAME_TOKEN} {{version}} est disponible`,
    });

    expect(saved['summary']).toBe(`${APP_INFO.name} {{version}} est disponible`);
  });

  it('substitutes a single key as well, for a translation set one key at a time', () => {
    expect(interceptor.preSaveTranslationKey('about.title', APP_NAME_TOKEN)).toBe(APP_INFO.name);
  });
});

/**
 * The invariant, asserted on the **shipped** files: a string written with the name in it
 * would render correctly today and go stale the day the name changes, which is the whole
 * point of taking it from `Cargo.toml`.
 */
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
  ])('carries the token instead (%s)', (_locale, translations) => {
    expect(strings(translations).some((value) => value.includes(APP_NAME_TOKEN))).toBe(true);
  });
});
