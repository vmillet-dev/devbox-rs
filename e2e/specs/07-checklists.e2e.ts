import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { editor } from '../pageobjects/editor.page.js';
import { clipboardText, reloadCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId, query } from '../support/bridge.js';

/**
 * `note_items` is keyed by position, so every write replaces the whole list. ⚠️ Reordering
 * is pointer events plus `Alt+↑/↓`, because HTML5 drag and drop receives nothing in this
 * WebView — the keyboard path is the one a test can drive.
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

  it('ticks an item from the editor', async () => {
    await canvas.openNote(title);
    await editor.toggleItem(0);
    expect(await editor.itemChecks()).toEqual([true, false, false]);
    await editor.close();

    expect((await reread())?.items?.[0]?.done).toBe(true);
  });

  it('ticks an item from the card, without opening it', async () => {
    // ⚠️ The items sit on a layer above the card button, which is why they can be clicked
    // at all — a `<div>` inside a `<button>` would be invalid HTML.
    const card = await canvas.cardWithTitle(title);
    await card.$('[data-testid="note-card-item"]').click();
    await browser.pause(600);

    // Toggled back off: the editor ticked this same item a moment ago.
    expect((await reread())?.items?.[0]?.done).toBe(false);
  });

  it('offers a drag handle that says what it moves', async () => {
    await canvas.openNote(title);
    // ⚠️ Asserted, not dragged — see `editor.grip`.
    const grip = await editor.grip(0);
    expect(await grip.isExisting()).toBe(true);
    expect(await grip.getAttribute('aria-label')).toContain('Tag the release');
    await editor.close();
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

  it('removes an item, and the whole list is rewritten', async () => {
    await canvas.openNote(title);
    await editor.removeItem(2);
    expect(await editor.itemTexts()).toEqual(['Write the changelog', 'Tag the release']);
    await editor.close();

    // The position *is* the identity, so a removal is a full replace, not a DELETE.
    expect(((await reread())?.items ?? []).map((item) => item.text)).toEqual([
      'Write the changelog',
      'Tag the release',
    ]);
  });

  it('carries the Markdown Rust rendered, not one the front end rebuilt', async () => {
    await canvas.openNote(title);
    await editor.toggleItem(0);
    await editor.close();
    await browser.pause(400);

    // `- [x] ` is `notes::checklist::to_markdown`'s syntax, reaching the card as
    // `DisplayNote.copyText`; the front end holds no second copy of it.
    const copyText = (await reread())?.copyText;
    expect(copyText).toContain('- [x] Write the changelog');
    expect(copyText).toContain('- [ ] Tag the release');
  });

  it('puts that same Markdown on the clipboard', async function () {
    const card = await canvas.cardWithTitle(title);
    await card.$('[data-testid="copy-button"]').click();
    await browser.pause(600);

    const copied = await clipboardText();
    if (copied === null) {
      // No readable clipboard on this runner. Skipped rather than returned: a bare
      // `return` is a green test that asserted nothing. See `clipboardText`.
      this.skip();
      return;
    }
    expect(copied).toContain('- [x] Write the changelog');
  });

  it('shows progress on the card', async () => {
    const card = await canvas.cardWithTitle(title);
    const progress = await card.$('[data-testid="note-card-progress"]').getText();
    expect(progress).toContain('1');
    expect(progress).toContain('2');
  });

  /** A card shows two items of a list; a search slides the window to the matching one. */
  describe('found by an item the card does not show', () => {
    const long = 'Deep list';

    before(async () => {
      await bridge.createNote(
        draft({
          spaceId: await homeSpaceId(),
          title: long,
          kind: 'checklist',
          items: [
            { text: 'first step', done: false },
            { text: 'second step', done: false },
            { text: 'third step', done: false },
            { text: 'rotate the kubeconfig', done: false },
          ],
        }),
      );
      await reloadCanvas();
    });

    after(async () => {
      await canvas.clearSearch();
    });

    it('slides its window to the item that matched', async () => {
      await canvas.search('kubeconfig');
      const card = await canvas.cardWithTitle(long);
      const texts = await card.$$('[data-testid="note-card-item"]').map((item) => item.getText());

      expect(texts.join(' ')).toContain('rotate the kubeconfig');
      expect(texts.join(' ')).not.toContain('first step');
    });

    /**
     * ⚠️ The template counts within the window, the position in the note is what gets
     * written: ticking the first visible box must not tick the first box of the list.
     */
    it('ticks the box it shows, not the one at the same place in the list', async () => {
      await canvas.search('kubeconfig');
      const card = await canvas.cardWithTitle(long);
      const boxes = await card.$$('[data-testid="note-card-item"]').getElements();
      // The second visible box, which is the last item of the list.
      await boxes[1]!.click();

      await browser.waitUntil(
        async () => {
          const view = await bridge.queryNotes(query({ search: long }));
          return view.sections[0]?.notes[0]?.items?.at(-1)?.done === true;
        },
        { timeout: 10_000, timeoutMsg: 'the matching item never came back ticked' },
      );

      const items = (await bridge.queryNotes(query({ search: long }))).sections[0]?.notes[0]?.items;
      expect(items?.map((item) => item.done)).toEqual([false, false, false, true]);
    });
  });
});
