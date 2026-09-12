import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { fileMenu, settings, titlebar } from '../pageobjects/titlebar.page.js';
import { restart } from '../support/app.js';

/**
 * A preference applies as it is typed — there is no OK anywhere in the panel — and
 * is written through to `preferences.json` one key at a time. Only a restart can
 * show that the file was actually written and read back: the store plugin's round
 * trip happens outside both unit suites.
 */
describe('Preferences', () => {
  before(canvas.open);

  it('opens from the File menu', async () => {
    await fileMenu.openPreferences();
    expect(await settings.page('general').isExisting()).toBe(true);
  });

  it('applies the theme as it is chosen, with no confirmation step', async () => {
    await settings.select(settings.theme(), 'light');

    // `:root[data-theme='light']` is what redefines the palette; dark is the base
    // because the preference lives in a file nothing can read before Angular boots.
    expect(await browser.$('html').getAttribute('data-theme')).toBe('light');
  });

  it('applies the density the same way', async () => {
    await settings.select(settings.density(), 'compact');
    expect(await browser.$('html').getAttribute('data-density')).toBe('compact');
  });

  it('switches the interface language from the panel', async () => {
    await settings.select(settings.locale(), 'en');
    expect(await titlebar.activeLocale()).toBe('en');
  });

  it('still holds all three after a restart', async () => {
    await settings.close();
    await restart();

    expect(await browser.$('html').getAttribute('data-theme')).toBe('light');
    expect(await browser.$('html').getAttribute('data-density')).toBe('compact');
    expect(await titlebar.activeLocale()).toBe('en');
  });

  it('captures a shortcut from the keyboard, and refuses one with no modifier', async () => {
    await fileMenu.openPreferences();
    const field = settings.shortcut();
    const before = await field.getValue();

    // A *global* accelerator without a modifier would swallow that key in every
    // application on the machine — which is also what leaves Tab and Escape
    // working inside the field.
    await field.click();
    await browser.keys('p');
    expect(await field.getValue()).toBe(before);

    // `KeyboardEvent.code`, so a combination set on AZERTY stays put on QWERTY.
    await browser.keys(['Control', 'Alt', 'j']);
    expect(await field.getValue()).toBe('Ctrl+Alt+J');

    await settings.resetShortcut();
    expect(await field.getValue()).toBe(before);
    await settings.close();
  });

  it('keeps the titlebar switch and the panel in agreement', async () => {
    await titlebar.setLocale('fr');
    await browser.pause(300);
    await fileMenu.openPreferences();

    expect(await settings.locale().getValue()).toBe('fr');
    await settings.close();
  });
});
