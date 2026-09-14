import { $, $$ } from '@wdio/globals';

import {
  blur,
  clickToAddRow,
  confirmTwice,
  press,
  readEach,
  setField,
  toggleAndWait,
  waitForCanvas,
  setNativeValue,
  submitFormOf,
  testid,
} from '../support/app.js';

/**
 * The editor overlay. Title, body and source commit on **blur**, so every setter here
 * blurs before returning — a spec asserting persistence right after typing would be
 * asserting on a draft nothing has saved.
 */
async function typeAndCommit(selector: string, text: string): Promise<void> {
  await setField(selector, text);
  await blur();
}

async function rowAt(selector: string, index: number) {
  const rows = await $$(selector).getElements();
  const row = rows[index];
  if (!row) {
    throw new Error(`no row at ${index} for ${selector} — found ${rows.length}`);
  }
  return row;
}

export const editor = {
  isOpen: () => $(testid('editor-title')).isExisting(),

  setTitle: (text: string) => typeAndCommit(testid('editor-title'), text),
  setBody: (text: string) => typeAndCommit(testid('editor-body'), text),
  setSource: (text: string) => typeAndCommit(testid('editor-source'), text),

  title: () => $(testid('editor-title')).getValue(),
  body: () => $(testid('editor-body')).getValue(),

  setLanguage: (language: string) => setNativeValue(testid('editor-language'), language),

  /** `yyyy-MM-dd`, which the editor converts to the end of the local day. */
  setDeadline: (isoDay: string) => setNativeValue(testid('editor-deadline'), isoDay),

  async addTag(tag: string): Promise<void> {
    // `setField` and not a bare `setValue`: submitting a field whose value never landed
    // adds an empty tag, silently, and the assertion blames the normalisation.
    await setField(testid('editor-tag-add'), tag);
    // The field commits by **submitting its form**, which Enter does natively and no
    // synthetic key can — see `submitFormOf`.
    await submitFormOf(testid('editor-tag-add'));

    // ⚠️ The field clearing only says the form was submitted. The **list** comes from the
    // note, so it appears after the write has crossed the bridge and come back: asserting
    // on the next line read `[]` where the tag was on its way.
    //
    // The comparison is loose on purpose — `#` and case are what
    // `notes::model::normalize_tags` decides, and the harness has no business deciding
    // it too. This is a wait for the gesture to have landed; the scenario still asserts
    // the exact list Rust produced.
    const expected = tag.trim().replace(/^#/, '').toLowerCase();
    await browser.waitUntil(
      async () => (await editor.tags()).some((each) => each.toLowerCase() === expected),
      { timeout: 10_000, timeoutMsg: `the tag "${tag}" never reached the editor` },
    );
  },

  /** Waits for it to be **gone**: the list follows the write, not the click. */
  async removeTag(tag: string): Promise<void> {
    await $(`${testid('editor-tag-remove')}[data-tag="${tag}"]`).click();

    await browser.waitUntil(async () => !(await editor.tags()).includes(tag), {
      timeout: 10_000,
      timeoutMsg: `the tag "${tag}" is still on the note`,
    });
  },

  tags: (): Promise<string[]> => readEach(testid('editor-tag-remove'), '@data-tag'),

  togglePin: () => toggleAndWait(testid('editor-pin')),
  isPinned: async () => (await $(testid('editor-pin')).getAttribute('aria-pressed')) === 'true',

  footer: () => $(testid('editor-footer')).getText(),

  toggleFullscreen: () => toggleAndWait(testid('editor-fullscreen')),
  isFullscreen: async () => (await $(testid('editor-fullscreen')).getAttribute('aria-pressed')) === 'true',

  /**
   * The shell's panel, measured: `aria-pressed` says the button was pressed, not that the
   * panel grew. Only the editor is open here, so the role is selector enough.
   */
  panelSize: () => $('[role="dialog"]').getSize(),

  /** Only shown for a note carrying `{{fields}}`; a plain note gets the ordinary copy button. */
  copyFilled: () => $(testid('editor-copy-filled')).click(),
  hasCopyFilled: () => $(testid('editor-copy-filled')).isExisting(),

  /**
   * Escape, the backdrop and the close button all produce no `blur`, so the component
   * commits the draft itself on the way out. Closing through the button is the path
   * that exercises that.
   */
  async close(): Promise<void> {
    await $(testid('editor-close')).click();
    await $(testid('editor-title')).waitForExist({ reverse: true, timeout: 10_000 });

    // ⚠️ Closing **commits**: the title, the source and the content all leave on the way
    // out, and the dialog disappears without waiting for any of them. A scenario that
    // reads the note back through the bridge on the next line reads it before the write.
    // Settling the canvas is the observable end of that round trip — the store reloads it
    // once the write has come back.
    await waitForCanvas();
  },

  async deleteNote(): Promise<void> {
    await confirmTwice($(testid('editor-delete')));
    await $(testid('editor-title')).waitForExist({ reverse: true, timeout: 10_000 });
  },

  // Checklists
  items: () => $$(testid('checklist-row')),

  itemTexts: (): Promise<string[]> => readEach(testid('checklist-row'), 'value', testid('checklist-text')),

  async itemChecks(): Promise<boolean[]> {
    const states = await readEach(testid('checklist-row'), '@aria-checked', testid('checklist-check'));
    return states.map((state) => state === 'true');
  },

  async addItem(text: string): Promise<void> {
    const row = await clickToAddRow(testid('checklist-add'), testid('checklist-row'));
    await row.$(testid('checklist-text')).setValue(text);
    await blur();
  },

  async toggleItem(index: number): Promise<void> {
    await (await rowAt(testid('checklist-row'), index)).$(testid('checklist-check')).click();
    await blur();
  },

  async removeItem(index: number): Promise<void> {
    await (await rowAt(testid('checklist-row'), index)).$(testid('checklist-remove')).click();
    await blur();
  },

  /**
   * ⚠️ Asserted on, not dragged. The grip is a pointer-drag handle
   * (`pointerdown` + `setPointerCapture` + `pointermove`), and synthesising a capture
   * through WebDriver is both unreliable and beside the point: `Alt+↑/↓` is its
   * keyboard twin, it has to work anyway for the linter, and it is what `moveItemUp`
   * drives. This only holds that the handle exists and says what it moves.
   */
  grip: (index: number) =>
    rowAt(testid('checklist-row'), index).then((row) => row.$(testid('checklist-grip'))),

  async moveItemUp(index: number): Promise<void> {
    const row = await rowAt(testid('checklist-row'), index);
    await row.$(testid('checklist-text')).click();
    await press('ArrowUp', ['Alt']);
    await blur();
  },

  // Fields
  fieldsPanelToggle: () => $(testid('placeholder-panel-toggle')),

  /** Trimmed: the count sits on its own line in the template, so `getText()` pads it. */
  fieldsPanelCount: async () => (await $(testid('placeholder-panel-count')).getText()).trim(),

  isFieldsPanelOpen: async () =>
    (await $(testid('placeholder-panel-toggle')).getAttribute('aria-expanded')) === 'true',

  /**
   * ⚠️ Scoped to the overlay. `placeholder-input` is the same hook in two places — this
   * panel and the fill form — and a bare `$()` returns whichever comes first in the DOM.
   * Unscoped, a spec that meant the form typed into the editor's panel instead, which
   * commits on `focusout`: the value was written by the test that meant to discard it.
   */
  field: (name: string) => $(`app-note-editor-overlay ${testid('placeholder-input')}[data-field="${name}"]`),

  async toggleFieldsPanel(): Promise<void> {
    await $(testid('placeholder-panel-toggle')).click();
  },

  /** Open by default — a folded panel would hide the feature from anyone who has not met it. */
  async openFieldsPanel(): Promise<void> {
    if (!(await editor.isFieldsPanelOpen())) {
      await editor.toggleFieldsPanel();
    }
  },

  // Attachments
  attachments: () => $$(testid('attachment-item')),
  attachmentEmpty: () => $(testid('attachment-empty')),

  attachmentNames: (): Promise<string[]> => readEach(testid('attachment-item'), '@data-file-name'),

  /**
   * ⚠️ Asserted on, never clicked — both of them open OS UI. "Add" raises the file
   * picker, which blocks the application until a human answers it, and "open" hands the
   * file to the desktop's default application. See `support/app.ts`.
   */
  attachmentAdd: () => $(testid('attachment-add')),
  attachmentOpen: (fileName: string) =>
    $(`${testid('attachment-item')}[data-file-name="${fileName}"]`).$(testid('attachment-open')),

  async removeAttachment(): Promise<void> {
    const remove = $(testid('attachment-remove'));
    await remove.click();
    await remove.click();
  },
};
