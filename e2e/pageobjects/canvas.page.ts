import { $, $$, browser } from '@wdio/globals';

import { testid, waitForCanvas } from '../support/app.js';

/**
 * The notes page: the header above the cards, and the cards themselves. Every selector
 * the scenarios use lives here, so a renamed `data-testid` is one edit.
 */
export const canvas = {
  open: waitForCanvas,

  cards: () => $$(testid('note-card')),

  async titles(): Promise<string[]> {
    const found: string[] = [];
    for await (const card of $$(testid('note-card'))) {
      found.push((await card.$(testid('note-card-title')).getText()).trim());
    }
    return found;
  },

  async cardWithTitle(title: string) {
    for await (const card of $$(testid('note-card'))) {
      if ((await card.$(testid('note-card-title')).getText()).trim() === title) {
        return card;
      }
    }
    throw new Error(`no card titled "${title}" — found ${JSON.stringify(await canvas.titles())}`);
  },

  async waitForCard(title: string): Promise<void> {
    await browser.waitUntil(async () => (await canvas.titles()).includes(title), {
      timeout: 15_000,
      timeoutMsg: `no card titled "${title}" appeared`,
    });
  },

  async waitForNoCard(title: string): Promise<void> {
    await browser.waitUntil(async () => !(await canvas.titles()).includes(title), {
      timeout: 15_000,
      timeoutMsg: `the card titled "${title}" is still there`,
    });
  },

  /**
   * Clicks the **title** and not the card: a checklist card carries its tickable items
   * on a layer over the card button, and a click aimed at the button's centre lands on
   * an item instead.
   */
  async openNote(title: string): Promise<void> {
    const card = await canvas.cardWithTitle(title);
    await card.$(testid('note-card-title')).click();
    await $(testid('editor-title')).waitForExist({ timeout: 10_000 });
  },

  /** The card button itself, which is the click surface a snippet card is opened by. */
  cardButton: (card: WebdriverIO.Element) => card.$(testid('note-card-open')),

  cardTags: (card: WebdriverIO.Element) => card.$(testid('note-card-tags')),

  async createSnippet(): Promise<void> {
    await $(testid('new-note')).click();
    await $(testid('editor-title')).waitForExist({ timeout: 10_000 });
  },

  /** Through the kind menu rather than the split button's default half. */
  async createSnippetFromMenu(): Promise<void> {
    await $(testid('new-note-kind')).click();
    await $(testid('new-note-snippet')).click();
    await $(testid('editor-title')).waitForExist({ timeout: 10_000 });
  },

  async createChecklist(): Promise<void> {
    await $(testid('new-note-kind')).click();
    await $(testid('new-note-checklist')).click();
    await $(testid('editor-title')).waitForExist({ timeout: 10_000 });
  },

  /** The empty card at the end of the `week` section, which is why that section is always emitted. */
  async createFromGhost(): Promise<void> {
    await $(testid('create-ghost')).click();
    await $(testid('editor-title')).waitForExist({ timeout: 10_000 });
  },

  /**
   * The search crosses the bridge behind a 150 ms debounce, so a spec that asserts
   * straight after typing reads the previous view.
   */
  async search(text: string): Promise<void> {
    const field = $(testid('search-input'));
    await field.click();
    await field.setValue(text);
    await browser.pause(400);
  },

  async clearSearch(): Promise<void> {
    const field = $(testid('search-input'));
    await field.click();
    // `setValue('')` rather than select-all-then-Backspace: it goes through the element
    // endpoint, which the embedded driver implements, where key actions are dropped.
    await field.setValue('');
    await browser.pause(400);
  },

  filter: (key: 'all' | 'pinned' | 'untriaged') => $(`${testid('filter-chip')}[data-filter="${key}"]`),
  tagPill: (tag: string) => $(`${testid('tag-pill')}[data-tag="${tag}"]`),
  languageChip: (language: string) => $(`${testid('language-chip')}[data-language="${language}"]`),
  sections: () => $$(testid('note-section')),

  async sectionKeys(): Promise<string[]> {
    const keys: string[] = [];
    for await (const section of $$(testid('note-section'))) {
      keys.push((await section.getAttribute('data-section')) ?? '');
    }
    return keys;
  },

  noResults: () => $(testid('canvas-no-results')),

  async openTagManager(): Promise<void> {
    await $(testid('tag-manage')).click();
    await $(testid('tag-manager-close')).waitForExist({ timeout: 10_000 });
  },

  // Multiple selection
  async check(title: string): Promise<void> {
    const card = await canvas.cardWithTitle(title);
    await card.$(testid('note-card-check')).click();
  },

  async isChecked(title: string): Promise<boolean> {
    const card = await canvas.cardWithTitle(title);
    return (await card.$(testid('note-card-check')).getAttribute('aria-pressed')) === 'true';
  },

  /** Opening an already-open menu closes it, so this asks rather than toggles. */
  async openCardMenu(title: string) {
    const card = await canvas.cardWithTitle(title);
    if (!(await card.$(testid('note-card-menu-panel')).isExisting())) {
      await card.$(testid('note-card-menu')).click();
      await card.$(testid('note-card-menu-panel')).waitForExist({ timeout: 5_000 });
    }
    return card;
  },

  /** Both destructive menus confirm on a second click; one click alone deletes nothing. */
  async deleteNote(title: string): Promise<void> {
    const card = await canvas.openCardMenu(title);
    const remove = card.$(testid('note-card-delete'));
    await remove.click();
    await remove.click();
  },

  async moveNote(title: string, spaceId: string): Promise<void> {
    const card = await canvas.openCardMenu(title);
    await card.$(`${testid('note-card-move')}[data-space-id="${spaceId}"]`).click();
  },
};
