import { $, $$, browser } from '@wdio/globals';

import { confirmTwice, setField, setNativeValue, submitFormOf, testid } from '../support/app.js';

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

  async names(): Promise<string[]> {
    const found: string[] = [];
    for await (const option of $$(testid('space-option'))) {
      found.push((await option.getText()).trim());
    }
    return found;
  },

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
   * The refuge is mandatory: without a target the notes would leave with the space.
   *
   * ⚠️ `setNativeValue` and not `selectByAttribute`, like every other `<select>` here.
   * It happens to work either way today — the delete button reads `targetSelect.value`
   * off a template ref — but the day that control becomes signal-bound, the driver's
   * missing `change` would silently delete with the wrong refuge.
   */
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

  async titles(): Promise<string[]> {
    const found: string[] = [];
    for await (const row of $$(testid('trash-row'))) {
      found.push((await row.$(testid('trash-row-title')).getText()).trim());
    }
    return found;
  },

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

  async rowWithTitle(title: string) {
    for await (const row of $$(testid('trash-row'))) {
      if ((await row.$(testid('trash-row-title')).getText()).trim() === title) {
        return row;
      }
    }
    throw new Error(`no trash row titled "${title}" — found ${JSON.stringify(await trash.titles())}`);
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

  async titles(): Promise<string[]> {
    const found: string[] = [];
    for await (const option of $$(testid('palette-option'))) {
      found.push((await option.getText()).trim());
    }
    return found;
  },

  async type(text: string): Promise<void> {
    await $(testid('palette-input')).setValue(text);
    await browser.pause(400);
  },
};

export const fieldsForm = {
  form: () => $(testid('placeholder-form')),

  /**
   * ⚠️ Scoped to the form. `placeholder-input` is the same hook in the editor's fields
   * panel, and a bare `$()` returns whichever comes first in the DOM — which is the
   * panel. See `editor.field`.
   */
  field: (name: string) =>
    $(testid('placeholder-form')).$(`${testid('placeholder-input')}[data-field="${name}"]`),

  submit: () => $(testid('placeholder-submit')).click(),

  /** ⚠️ Copies **and dismisses**: there is no form left to cancel afterwards. */
  copyRaw: () => $(testid('placeholder-copy-raw')).click(),

  cancel: () => $(testid('placeholder-cancel')).click(),
};

/** Reached from the end of the tag rail: it is a view on the notes, not a File entry. */
export const tagManager = {
  tag: (tag: string) => $(`${testid('tag-item')}[data-tag="${tag}"]`),
  select: (tag: string) => $(`${testid('tag-item')}[data-tag="${tag}"]`).click(),

  isSelected: async (tag: string) =>
    (await $(`${testid('tag-item')}[data-tag="${tag}"]`).getAttribute('aria-pressed')) === 'true',

  async tags(): Promise<string[]> {
    const found: string[] = [];
    for await (const item of $$(testid('tag-item'))) {
      found.push((await item.getAttribute('data-tag')) ?? '');
    }
    return found;
  },

  async setTarget(value: string): Promise<void> {
    const field = $(testid('tag-target'));
    await field.click();
    await field.setValue(value);
  },

  /** Submits the form rather than clicking, so the `<button type="submit">` path is the one taken. */
  apply: () => submitFormOf(testid('tag-target')),

  isApplyDisabled: async () => (await $(testid('tag-apply')).getAttribute('aria-disabled')) === 'true',

  async delete(): Promise<void> {
    const button = $(testid('tag-delete'));
    await button.click();
    await button.click();
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
