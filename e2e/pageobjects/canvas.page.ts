import { $, $$, browser } from '@wdio/globals';
import type { ChainablePromiseElement } from 'webdriverio';

import { readEach, setField, testid, toggleAndWait, waitForCanvas } from '../support/app.js';

/** Every selector the scenarios use lives here, so a renamed `data-testid` is one edit. */
export const canvas = {
  open: waitForCanvas,

  cards: () => $$(testid('note-card')),

  /**
   * ⚠️ Read in one call: a round trip per card leaves a window in which the canvas
   * re-renders, and the list that comes back mixes two states.
   */
  async titles(): Promise<string[]> {
    return browser.execute(
      (selector: string, titleSelector: string) =>
        [...document.querySelectorAll(selector)].map((card) =>
          (card.querySelector(titleSelector)?.textContent ?? '').trim(),
        ),
      testid('note-card'),
      testid('note-card-title'),
    );
  },

  /**
   * ⚠️ The note id behind a title, matched in one call for the same reason `titles()` is.
   * The card is then addressed by that id, so what comes back is resolved against the
   * canvas as it is now rather than against a position in a list that has moved.
   */
  async noteIdWithTitle(title: string): Promise<string> {
    await canvas.waitForCard(title);

    const id = await browser.execute(
      (cardSelector: string, titleSelector: string, wanted: string) =>
        [...document.querySelectorAll(cardSelector)]
          .find((card) => (card.querySelector(titleSelector)?.textContent ?? '').trim() === wanted)
          ?.getAttribute('data-note-id') ?? null,
      testid('note-card'),
      testid('note-card-title'),
      title,
    );

    if (id === null) {
      throw new Error(`no card titled "${title}" — found ${JSON.stringify(await canvas.titles())}`);
    }

    return id;
  },

  /** A selector and not a resolved element: it re-resolves on every command. */
  async cardWithTitle(title: string) {
    const id = await canvas.noteIdWithTitle(title);
    return $(`${testid('note-card')}[data-note-id="${id}"]`);
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
   * ⚠️ Clicks the title and not the card: a checklist card carries its tickable items on
   * a layer over the card button, and a click at the centre lands on an item.
   */
  async openNote(title: string): Promise<void> {
    const card = await canvas.cardWithTitle(title);
    await card.$(testid('note-card-title')).click();
    await $(testid('editor-title')).waitForExist({ timeout: 10_000 });
  },

  /** `ChainablePromiseElement` and not `Element`: a resolved element would go stale. */
  cardButton: (card: ChainablePromiseElement) => card.$(testid('note-card-open')),

  cardTags: (card: ChainablePromiseElement) => card.$(testid('note-card-tags')),

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

  /** The empty card at the end of the `week` section, which is why it is always emitted. */
  async createFromGhost(): Promise<void> {
    await $(testid('create-ghost')).click();
    await $(testid('editor-title')).waitForExist({ timeout: 10_000 });
  },

  /**
   * ⚠️ The search crosses the bridge behind a 150 ms debounce, so a spec asserting
   * straight after typing reads the previous view.
   */
  async search(text: string): Promise<void> {
    await setField(testid('search-input'), text);
    // The condition rather than a guess at the debounce plus the round trip.
    await waitForCanvas();
  },

  async clearSearch(): Promise<void> {
    // ⚠️ `setValue('')` rather than select-all-then-Backspace: it goes through the element
    // endpoint, which the embedded driver implements, where key actions are dropped.
    await setField(testid('search-input'), '');
    await waitForCanvas();
  },

  filter: (key: 'all' | 'pinned' | 'untriaged') => $(`${testid('filter-chip')}[data-filter="${key}"]`),
  tagPill: (tag: string) => $(`${testid('tag-pill')}[data-tag="${tag}"]`),
  languageChip: (language: string) => $(`${testid('language-chip')}[data-language="${language}"]`),

  /** The three controls that re-run the query, each waited on rather than slept past. */
  async applyFilter(key: 'all' | 'pinned' | 'untriaged'): Promise<void> {
    await canvas.filter(key).click();
    await waitForCanvas();
  },

  async toggleTag(tag: string): Promise<void> {
    await canvas.tagPill(tag).click();
    await waitForCanvas();
  },

  async toggleLanguage(language: string): Promise<void> {
    await canvas.languageChip(language).click();
    await waitForCanvas();
  },
  sections: () => $$(testid('note-section')),

  sectionKeys: (): Promise<string[]> => readEach(testid('note-section'), '@data-section'),

  noResults: () => $(testid('canvas-no-results')),

  /** What the search field says instead of its shortcut hint while filtering. */
  matchedCount: () => $(testid('search-matched')).getText(),

  async openTagManager(): Promise<void> {
    await $(testid('tag-manage')).click();
    await $(testid('tag-manager-close')).waitForExist({ timeout: 10_000 });
  },

  // Multiple selection
  async check(title: string): Promise<void> {
    const id = await canvas.noteIdWithTitle(title);
    await toggleAndWait(`${testid('note-card')}[data-note-id="${id}"] ${testid('note-card-check')}`);
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
