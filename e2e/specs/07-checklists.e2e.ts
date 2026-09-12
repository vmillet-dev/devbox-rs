import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { editor } from '../pageobjects/editor.page.js';
import { clipboardText } from '../support/app.js';
import { bridge, query } from '../support/bridge.js';

/**
 * A todo list has items and no body: `note_items` is keyed by position, so every
 * write replaces the whole list. Reordering is pointer events plus `Alt+↑/↓`,
 * because HTML5 drag and drop receives nothing in this WebView — the keyboard path
 * is the one a test can drive, and the one that has to work anyway.
 */
describe('Todo lists', () => {
  const title = 'Release checklist';

  before(canvas.open);

  async function reread() {
    const view = await bridge.queryNotes(query({ search: title }));
    return view.sections[0]?.notes[0];
  }

  it('creates a note of the checklist kind', async () => {
    await canvas.createChecklist();
    await editor.setTitle(title);
    await editor.addItem('Tag the release');
    await editor.close();

    await canvas.waitForCard(title);
    expect((await reread())?.kind).toBe('checklist');
  });

  it('keeps the items in the order they were added', async () => {
    await canvas.openNote(title);
    await editor.addItem('Write the changelog');
    await editor.addItem('Publish the binaries');
    await editor.close();

    expect(((await reread())?.items ?? []).map((item) => item.text)).toEqual([
      'Tag the release',
      'Write the changelog',
      'Publish the binaries',
    ]);
  });

  it('ticks an item from the card, without opening it', async () => {
    // The items sit on a layer above the card button, which is why they can be
    // clicked at all — a <div> inside a <button> would be invalid HTML.
    const card = await canvas.cardWithTitle(title);
    await card.$('[data-testid="note-card-item"]').click();
    await browser.pause(600);

    expect((await reread())?.items?.[0]?.done).toBe(true);
  });

  it('reorders with Alt+arrow, the twin of the pointer drag', async () => {
    await canvas.openNote(title);
    await editor.moveItemUp(1);
    await editor.close();

    expect(((await reread())?.items ?? []).map((item) => item.text)).toEqual([
      'Write the changelog',
      'Tag the release',
      'Publish the binaries',
    ]);
  });

  it('carries the Markdown Rust rendered, not one the front end rebuilt', async () => {
    // `- [x] ` is `notes::checklist::to_markdown`'s syntax, reaching the card as
    // `DisplayNote.copyText`; the front end holds no second copy of it.
    const copyText = (await reread())?.copyText;
    expect(copyText).toContain('- [x] Tag the release');
    expect(copyText).toContain('- [ ] Publish the binaries');
  });

  it('puts that same Markdown on the clipboard', async () => {
    const card = await canvas.cardWithTitle(title);
    await card.$('[data-testid="copy-button"]').click();
    await browser.pause(600);

    const copied = await clipboardText();
    if (copied === null) {
      // Another process holds the Windows clipboard; see `clipboardText`.
      console.warn('clipboard not readable on this machine — assertion skipped');
      return;
    }
    expect(copied).toContain('- [x] Tag the release');
  });

  it('shows progress on the card', async () => {
    const card = await canvas.cardWithTitle(title);
    const progress = await card.$('[data-testid="note-card-progress"]').getText();
    expect(progress).toContain('1');
    expect(progress).toContain('3');
  });
});
