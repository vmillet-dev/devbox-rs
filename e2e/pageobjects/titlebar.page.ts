import { $, $$, browser } from '@wdio/globals';

import { clickToAddRow, blur, setNativeValue, testid } from '../support/app.js';

/** The controls' `id`s, in one place: `select` needs the selector, the getters the element. */
const CONTROL = {
  theme: '#setting-theme',
  density: '#setting-density',
  locale: '#setting-locale',
} as const;

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

  /** ⚠️ Asserted on, never clicked: it would take the application down mid-run. */
  quit: () => $(testid('file-quit')),

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
   * The preference controls are addressed by their `id`, which is not a test hook but
   * the `for` target of their own `<label>` — it cannot be renamed without breaking the
   * association, which makes it as stable as a `data-testid`.
   */
  control: CONTROL,

  locale: () => $(CONTROL.locale),
  shortcut: () => $('#setting-shortcut'),
  resetShortcut: () => $('.setting-shortcut-reset').click(),

  /** Takes the selector and not the element: `setNativeValue` assigns and dispatches. */
  async select(selector: string, value: string): Promise<void> {
    await setNativeValue(selector, value);
    await browser.pause(200);
  },
};

export const variables = {
  async open(): Promise<void> {
    await fileMenu.openPreferences();
    await settings.page('notes.variables').click();
  },

  rows: () => $$(testid('variable-row')),

  async names(): Promise<string[]> {
    const found: string[] = [];
    for await (const row of $$(testid('variable-row'))) {
      found.push(await row.$(testid('variable-name')).getValue());
    }
    return found;
  },

  async add(name: string, value: string): Promise<void> {
    const last = await clickToAddRow(testid('variable-add'), testid('variable-row'));
    await last.$(testid('variable-name')).setValue(name);
    await last.$(testid('variable-value')).setValue(value);
    await blur();
    await browser.pause(200);
  },

  async remove(name: string): Promise<void> {
    for await (const row of $$(testid('variable-row'))) {
      if ((await row.$(testid('variable-name')).getValue()) === name) {
        await row.$(testid('variable-remove')).click();
        await blur();
        await browser.pause(200);
        return;
      }
    }
    throw new Error(`no variable row named "${name}" — found ${JSON.stringify(await variables.names())}`);
  },
};

export const banners = {
  status: () => $(testid('status-toast')),
  error: () => $(testid('error-banner')),
};
