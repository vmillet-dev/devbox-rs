import { $, $$, browser } from '@wdio/globals';

import { blur, clickToAddRow, readEach, setNativeValue, testid } from '../support/app.js';

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

  /** One call: two reads leave a window in which the pressed option can change. */
  activeLocale: async (): Promise<string> =>
    (
      await browser.execute(
        (selector: string) =>
          [...document.querySelectorAll(selector)]
            .filter((option) => option.getAttribute('aria-pressed') === 'true')
            .map((option) => option.getAttribute('data-locale') ?? ''),
        testid('locale-option'),
      )
    )[0] ?? '',
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

  names: (): Promise<string[]> => readEach(testid('variable-row'), 'value', testid('variable-name')),

  async add(name: string, value: string): Promise<void> {
    const last = await clickToAddRow(testid('variable-add'), testid('variable-row'));
    await last.$(testid('variable-name')).setValue(name);
    await last.$(testid('variable-value')).setValue(value);
    await blur();
    await browser.pause(200);
  },

  async remove(name: string): Promise<void> {
    // The row has to **be there** before it can be found. Reading once and giving up is
    // how this reported `no variable row named "port" — found ["port"]`: the second read,
    // the one in the error message, saw the row the first had missed.
    await browser.waitUntil(async () => (await variables.names()).includes(name), {
      timeout: 10_000,
      timeoutMsg: `no variable row named "${name}" ever appeared`,
    });

    const index = (await variables.names()).indexOf(name);
    if (index >= 0) {
      const rows = await $$(testid('variable-row')).getElements();
      const row = rows[index];
      if (row) {
        await row.$(testid('variable-remove')).click();
        await blur();
        await browser.waitUntil(async () => !(await variables.names()).includes(name), {
          timeout: 10_000,
          timeoutMsg: `the variable "${name}" is still listed`,
        });
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
