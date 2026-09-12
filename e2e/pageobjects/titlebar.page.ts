import { $, $$, browser } from '@wdio/globals';

import { testid } from '../support/app.js';

export const titlebar = {
  title: () => $(testid('titlebar-title')).getText(),

  /** One of the few untranslated labels, so a scenario can pin the language it asserts in. */
  setLocale: (locale: 'fr' | 'en') => $(`${testid('locale-option')}[data-locale="${locale}"]`).click(),

  activeLocale: async (): Promise<string> => {
    for await (const option of $$(testid('locale-option'))) {
      if ((await option.getAttribute('aria-pressed')) === 'true') {
        return (await option.getAttribute('data-locale')) ?? '';
      }
    }
    return '';
  },
};

export const fileMenu = {
  open: () => $(testid('file-menu')).click(),
  entry: (id: string) => $(`${testid('file-option')}[data-entry="${id}"]`),

  async isDisabled(id: string): Promise<boolean> {
    return (await fileMenu.entry(id).getAttribute('aria-disabled')) === 'true';
  },

  async openPreferences(): Promise<void> {
    await $(testid('file-menu')).click();
    await $(testid('file-preferences')).click();
    await $(testid('settings-page')).waitForExist({ timeout: 10_000 });
  },
};

export const settings = {
  page: (id: string) => $(`${testid('settings-page')}[data-page="${id}"]`),
  close: () => $(testid('settings-close')).click(),

  /**
   * The preference controls are addressed by their `id`, which is not a test hook
   * but the `for` target of their own `<label>` — it cannot be renamed without
   * breaking the association, which makes it as stable as a `data-testid`.
   */
  theme: () => $('#setting-theme'),
  density: () => $('#setting-density'),
  locale: () => $('#setting-locale'),
  pinnedFirst: () => $('#setting-pinned-first'),
  shortcut: () => $('#setting-shortcut'),
  resetShortcut: () => $('.setting-shortcut-reset').click(),

  async select(control: ChainablePromiseElement, value: string): Promise<void> {
    await control.selectByAttribute('value', value);
    await browser.pause(200);
  },
};

export const variables = {
  async open(): Promise<void> {
    await fileMenu.openPreferences();
    await settings.page('notes.variables').click();
  },

  rows: () => $$(testid('variable-row')),

  async add(name: string, value: string): Promise<void> {
    await $(testid('variable-add')).click();
    const rows = await $$(testid('variable-row')).getElements();
    const last = rows[rows.length - 1];
    if (!last) {
      throw new Error('the variables page gained no row');
    }
    await last.$(testid('variable-name')).setValue(name);
    await last.$(testid('variable-value')).setValue(value);
    await browser.keys('Tab');
    await browser.pause(200);
  },
};

export const banners = {
  status: () => $(testid('status-toast')),
  error: () => $(testid('error-banner')),
};
