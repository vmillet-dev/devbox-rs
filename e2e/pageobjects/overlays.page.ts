import { $, $$, browser } from '@wdio/globals';

import { confirmTwice, readEach, setField, setNativeValue, submitFormOf, testid } from '../support/app.js';

/** The space switcher, which is a menu, a create form and an edit panel in one. */
export const spaces = {
  /** Ensures the dropdown is showing: clicking the trigger again would close it. */
  async open(): Promise<void> {
    if (!(await $(testid('space-dropdown')).isExisting())) {
      await $(testid('space-switcher')).click();
      await $(testid('space-dropdown')).waitForExist({ timeout: 5_000 });
    }
  },

  async close(): Promise<void> {
    if (await $(testid('space-dropdown')).isExisting()) {
      await $(testid('space-switcher')).click();
      await $(testid('space-dropdown')).waitForExist({ reverse: true, timeout: 5_000 });
    }
  },

  label: () => $(testid('space-switcher')).getText(),
  option: (id: string) => $(`${testid('space-option')}[data-space-id="${id}"]`),

  /** `null` is "all spaces", and it is a choice rather than a loading state. */
  allOption: () => $(testid('space-option-all')),

  names: (): Promise<string[]> => readEach(testid('space-option'), 'text'),

  async create(name: string): Promise<void> {
    await $(testid('space-create-open')).click();
    // The form is revealed by that click: the field does not exist until it lands.
    await setField(testid('space-create-input'), name);
    await $(testid('space-create-submit')).click();
  },

  async rename(id: string, into: string): Promise<void> {
    await $(`${testid('space-edit')}[data-space-id="${id}"]`).click();
    await setField(testid('space-rename-input'), into);
    await $(testid('space-rename-submit')).click();
  },

  /**
   * ⚠️ `setNativeValue` and not `selectByAttribute`, like every other `<select>` here: it
   * works either way today, but the day the control becomes signal-bound the driver's
   * missing `change` would silently delete with the wrong refuge.
   */
  /** From the same panel as the rename and the delete, which the ⋯ opens. */
  /**
   * ⚠️ Closes behind itself: the edit panel replaces the menu rather than sitting over it,
   * so `open()` would find the dropdown already showing and leave the next caller here.
   */
  async togglePin(id: string): Promise<void> {
    await $(`${testid('space-edit')}[data-space-id="${id}"]`).click();
    await $(testid('space-pin')).click();
    await spaces.close();
  },

  async remove(id: string, refugeId: string): Promise<void> {
    await $(`${testid('space-edit')}[data-space-id="${id}"]`).click();
    await setNativeValue(testid('space-move-target'), refugeId);
    await confirmTwice($(testid('space-delete')));
  },

  deleteBlocked: () => $(testid('space-delete-blocked')),
};

export const trash = {
  async open(): Promise<void> {
    await $(testid('trash-open')).click();
    await $(testid('trash-close')).waitForExist({ timeout: 10_000 });
  },

  rows: () => $$(testid('trash-row')),

  titles: (): Promise<string[]> => readEach(testid('trash-row'), 'text', testid('trash-row-title')),

  async restore(title: string): Promise<void> {
    const row = await trash.rowWithTitle(title);
    await row.$(testid('trash-restore')).click();
  },

  async purge(title: string): Promise<void> {
    const row = await trash.rowWithTitle(title);
    await confirmTwice(row.$(testid('trash-purge')));
  },

  /** Confirms on a second click, like every destructive control in the application. */
  async empty(): Promise<void> {
    await confirmTwice($(testid('trash-empty')));
  },

  /** Matched in one call and used as a selector, like `canvas.cardWithTitle`. */
  async rowWithTitle(title: string) {
    // Waited for, not read once: a single read that lands early reports a row missing
    // that is merely late.
    await browser.waitUntil(async () => (await trash.titles()).includes(title), {
      timeout: 10_000,
      timeoutMsg: `no trash row titled "${title}" ever appeared`,
    });

    const titles = await trash.titles();
    const index = titles.indexOf(title);
    if (index < 0) {
      throw new Error(`no trash row titled "${title}" — found ${JSON.stringify(titles)}`);
    }

    const ids = await readEach(testid('trash-row'), '@data-note-id');
    const id = ids[index];
    if (!id) {
      throw new Error(`the trash row titled "${title}" carries no id`);
    }

    return $(`${testid('trash-row')}[data-note-id="${id}"]`);
  },

  close: () => $(testid('trash-close')).click(),
  emptyState: () => $(testid('trash-empty-state')),
};

export const undoBar = {
  bar: () => $(testid('undo-bar')),
  restore: () => $(testid('undo-restore')).click(),
  dismiss: () => $(testid('undo-dismiss')).click(),
};

export const palette = {
  input: () => $(testid('palette-input')),
  options: () => $$(testid('palette-option')),
  createRow: () => $(testid('palette-create')),
  empty: () => $(testid('palette-empty')),

  titles: (): Promise<string[]> => readEach(testid('palette-option'), 'text'),

  async type(text: string): Promise<void> {
    await $(testid('palette-input')).setValue(text);
    await browser.pause(400);
  },
};

export const fieldsForm = {
  form: () => $(testid('placeholder-form')),

  /** ⚠️ Scoped to the form: `placeholder-input` is the same hook in the editor's panel. */
  field: (name: string) =>
    $(testid('placeholder-form')).$(`${testid('placeholder-input')}[data-field="${name}"]`),

  submit: () => $(testid('placeholder-submit')).click(),

  /** ⚠️ Copies and dismisses: there is no form left to cancel afterwards. */
  copyRaw: () => $(testid('placeholder-copy-raw')).click(),

  cancel: () => $(testid('placeholder-cancel')).click(),
};

/** Reached from the end of the tag rail: it is a view on the notes, not a File entry. */
export const tagManager = {
  tag: (tag: string) => $(`${testid('tag-item')}[data-tag="${tag}"]`),
  select: (tag: string) => $(`${testid('tag-item')}[data-tag="${tag}"]`).click(),

  isSelected: async (tag: string) =>
    (await $(`${testid('tag-item')}[data-tag="${tag}"]`).getAttribute('aria-pressed')) === 'true',

  tags: (): Promise<string[]> => readEach(testid('tag-item'), '@data-tag'),

  async setTarget(value: string): Promise<void> {
    const field = $(testid('tag-target'));
    await field.click();
    await field.setValue(value);
  },

  /** Submits the form rather than clicking, so the `type="submit"` path is the one taken. */
  propose: () => submitFormOf(testid('tag-target')),

  proposeDelete: () => $(testid('tag-delete')).click(),

  confirmation: () => $(testid('tag-confirm')),

  confirm: () => $(testid('tag-confirm-apply')).click(),

  cancel: () => $(testid('tag-confirm-cancel')).click(),

  isApplyDisabled: async () => (await $(testid('tag-apply')).getAttribute('aria-disabled')) === 'true',

  /** Nothing corpus-wide writes without passing through the confirmation. */
  async apply(): Promise<void> {
    await submitFormOf(testid('tag-target'));
    await $(testid('tag-confirm-apply')).waitForDisplayed({ timeout: 10_000 });
    await $(testid('tag-confirm-apply')).click();
  },

  async delete(): Promise<void> {
    await $(testid('tag-delete')).click();
    await $(testid('tag-confirm-apply')).waitForDisplayed({ timeout: 10_000 });
    await $(testid('tag-confirm-apply')).click();
  },

  close: () => $(testid('tag-manager-close')).click(),
};

/** Shown only while at least one card is ticked. */
export const selectionBar = {
  bar: () => $(testid('selection-bar')),
  count: () => $(testid('selection-count')).getText(),
  clear: () => $(testid('selection-clear')).click(),
  copy: () => $(testid('selection-copy')).click(),

  moveTo: (spaceId: string) => setNativeValue(testid('selection-move'), spaceId),

  async tag(tag: string): Promise<void> {
    const field = $(testid('selection-tag'));
    await field.click();
    await field.setValue(tag);
    await submitFormOf(testid('selection-tag'));
  },

  async delete(): Promise<void> {
    const button = $(testid('selection-delete'));
    await button.click();
    await button.click();
  },
};
