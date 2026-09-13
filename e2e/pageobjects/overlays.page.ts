import { $, $$, browser } from '@wdio/globals';

import { testid } from '../support/app.js';

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

  async names(): Promise<string[]> {
    const found: string[] = [];
    for await (const option of $$(testid('space-option'))) {
      found.push((await option.getText()).trim());
    }
    return found;
  },

  async create(name: string): Promise<void> {
    await $(testid('space-create-open')).click();
    await $(testid('space-create-input')).setValue(name);
    await $(testid('space-create-submit')).click();
  },

  async rename(id: string, into: string): Promise<void> {
    await $(`${testid('space-edit')}[data-space-id="${id}"]`).click();
    const field = $(testid('space-rename-input'));
    await field.click();
    await field.setValue(into);
    await $(testid('space-rename-submit')).click();
  },

  /** The refuge is mandatory: without a target the notes would leave with the space. */
  async remove(id: string, refugeId: string): Promise<void> {
    await $(`${testid('space-edit')}[data-space-id="${id}"]`).click();
    await $(testid('space-move-target')).selectByAttribute('value', refugeId);
    const remove = $(testid('space-delete'));
    await remove.click();
    await remove.click();
  },

  deleteBlocked: () => $(testid('space-delete-blocked')),
};

export const trash = {
  async open(): Promise<void> {
    await $(testid('trash-open')).click();
    await $(testid('trash-row'))
      .waitForExist({ timeout: 10_000 })
      .catch(() => undefined);
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
    const button = row.$(testid('trash-purge'));
    await button.click();
    await button.click();
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
  field: (name: string) => $(`${testid('placeholder-input')}[data-field="${name}"]`),
  submit: () => $(testid('placeholder-submit')).click(),
  copyRaw: () => $(testid('placeholder-copy-raw')).click(),
  cancel: () => $(testid('placeholder-cancel')).click(),
};

export const tagManager = {
  tag: (tag: string) => $(`${testid('tag-item')}[data-tag="${tag}"]`),
  target: () => $(testid('tag-target')),
  apply: () => $(testid('tag-apply')).click(),
  close: () => $(testid('tag-manager-close')).click(),
};
