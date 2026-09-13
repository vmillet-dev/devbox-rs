import { $, $$, browser } from '@wdio/globals';

import { blur, press, submitFormOf, testid } from '../support/app.js';

/**
 * The editor overlay. Title, body and source commit on **blur**, so every setter
 * here blurs before returning — a spec that asserts persistence right after typing
 * would be asserting on a draft nothing has saved.
 */
async function typeAndCommit(selector: string, text: string): Promise<void> {
  const field = $(selector);
  await field.click();
  await field.setValue(text);
  await blur();
}

export const editor = {
  isOpen: () => $(testid('editor-title')).isExisting(),

  setTitle: (text: string) => typeAndCommit(testid('editor-title'), text),
  setBody: (text: string) => typeAndCommit(testid('editor-body'), text),
  setSource: (text: string) => typeAndCommit(testid('editor-source'), text),

  title: () => $(testid('editor-title')).getValue(),
  body: () => $(testid('editor-body')).getValue(),

  /**
   * ⚠️ Assigned and dispatched rather than selected, for the same reason as
   * `setDeadline` below: the embedded WebDriver server moves the selection without
   * the `change` the component listens to, so the language stayed `txt` while the
   * `<select>` showed `sh`.
   */
  async setLanguage(language: string): Promise<void> {
    await $(testid('editor-language')).waitForExist({ timeout: 5_000 });
    await browser.execute(
      (selector: string, value: string) => {
        const field = document.querySelector(selector) as HTMLSelectElement;
        field.value = value;
        field.dispatchEvent(new Event('change', { bubbles: true }));
      },
      testid('editor-language'),
      language,
    );
  },

  async addTag(tag: string): Promise<void> {
    const field = $(testid('editor-tag-add'));
    await field.click();
    await field.setValue(tag);
    // The field commits by **submitting its form**, which Enter does natively and no
    // synthetic key can — see `submitFormOf`.
    await submitFormOf(testid('editor-tag-add'));
  },

  removeTag: (tag: string) => $(`${testid('editor-tag-remove')}[data-tag="${tag}"]`).click(),

  async tags(): Promise<string[]> {
    const found: string[] = [];
    for await (const button of $$(testid('editor-tag-remove'))) {
      found.push((await button.getAttribute('data-tag')) ?? '');
    }
    return found;
  },

  togglePin: () => $(testid('editor-pin')).click(),
  isPinned: async () => (await $(testid('editor-pin')).getAttribute('aria-pressed')) === 'true',

  /**
   * `yyyy-MM-dd`, which the editor converts to the end of the local day.
   *
   * ⚠️ Assigned and dispatched rather than typed: an `<input type="date">` accepts
   * keystrokes in the **display** format, which follows the WebView's locale — a
   * spec typing `15/06/2030` would pass here and fail on an English runner. What
   * this skips is the browser's own date parsing; the component's `(change)`
   * handler, `endOfLocalDay`, the patch and the round trip all still run.
   */
  async setDeadline(isoDay: string): Promise<void> {
    await $(testid('editor-deadline')).waitForExist({ timeout: 5_000 });
    await browser.execute(
      (selector: string, value: string) => {
        const field = document.querySelector(selector) as HTMLInputElement;
        field.value = value;
        field.dispatchEvent(new Event('change', { bubbles: true }));
      },
      testid('editor-deadline'),
      isoDay,
    );
  },

  /**
   * Escape, the backdrop and the close button all produce no `blur`, so the
   * component commits the draft itself on the way out. Closing through the button
   * is the path that exercises that.
   */
  async close(): Promise<void> {
    await $(testid('editor-close')).click();
    await $(testid('editor-title')).waitForExist({ reverse: true, timeout: 10_000 });
  },

  async deleteNote(): Promise<void> {
    const remove = $(testid('editor-delete'));
    await remove.click();
    await remove.click();
    await $(testid('editor-title')).waitForExist({ reverse: true, timeout: 10_000 });
  },

  // Checklists
  items: () => $$(testid('checklist-row')),

  async itemTexts(): Promise<string[]> {
    const texts: string[] = [];
    for await (const row of $$(testid('checklist-row'))) {
      texts.push(await row.$(testid('checklist-text')).getValue());
    }
    return texts;
  },

  async addItem(text: string): Promise<void> {
    await $(testid('checklist-add')).click();
    const rows = await $$(testid('checklist-row')).getElements();
    const last = rows[rows.length - 1];
    if (!last) {
      throw new Error('the checklist gained no row');
    }
    await last.$(testid('checklist-text')).setValue(text);
    await blur();
  },

  /** Alt+↑/↓ and not the grip: the pointer drag has a keyboard twin, and it is the testable one. */
  async moveItemUp(index: number): Promise<void> {
    const rows = await $$(testid('checklist-row')).getElements();
    const row = rows[index];
    if (!row) {
      throw new Error(`no checklist row at ${index}`);
    }
    await row.$(testid('checklist-text')).click();
    await press('ArrowUp', ['Alt']);
    await blur();
  },

  // Fields
  fieldsPanelToggle: () => $(testid('placeholder-panel-toggle')),
  field: (name: string) => $(`${testid('placeholder-input')}[data-field="${name}"]`),
};
