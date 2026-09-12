import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { trash, undoBar } from '../pageobjects/overlays.page.js';
import { reloadCanvas } from '../support/app.js';
import { bridge, draft, firstSpaceId, query } from '../support/bridge.js';

/**
 * Deleting a note does not delete it: `deleted_at` is stamped and retention decides
 * later. Every read has to filter on it, which is only observable against a database
 * that holds both kinds of row at once.
 */
describe('Deleting a note, and taking it back', () => {
  let spaceId = '';

  before(async () => {
    await canvas.open();
    spaceId = await firstSpaceId();
  });

  async function seed(title: string): Promise<void> {
    await bridge.createNote(draft({ spaceId, title }));
    await reloadCanvas();
    await canvas.waitForCard(title);
  }

  it('needs the second click to delete anything', async () => {
    await seed('Armed but not fired');
    const card = await canvas.openCardMenu('Armed but not fired');
    await card.$('[data-testid="note-card-delete"]').click();

    // One click only arms the confirmation — a spec asserting after a single
    // click would pass while the note is still there.
    await browser.pause(500);
    expect((await bridge.queryNotes(query({ search: 'Armed but not fired' }))).matched).toBe(1);

    // Leave nothing armed for the next test.
    await browser.keys('Escape');
  });

  it('moves the note to the trash rather than dropping it', async () => {
    await seed('Delete me once');
    await canvas.deleteNote('Delete me once');
    await canvas.waitForNoCard('Delete me once');

    expect((await bridge.queryNotes(query({ search: 'Delete me once' }))).matched).toBe(0);
    const trashed = await bridge.listTrash();
    expect(trashed.map((row) => row.title)).toContain('Delete me once');
  });

  it('offers an undo, and honours it', async () => {
    await undoBar.bar().waitForExist({ timeout: 10_000 });
    await undoBar.restore();

    await canvas.waitForCard('Delete me once');
    expect((await bridge.listTrash()).map((row) => row.title)).not.toContain('Delete me once');
  });

  it('keeps the undo available after the banner has gone', async () => {
    await seed('Undo by keyboard');
    await canvas.deleteNote('Undo by keyboard');
    await canvas.waitForNoCard('Undo by keyboard');

    // The banner is what the 8 s timer clears; the record it suggests is not.
    await undoBar.bar().waitForExist({ reverse: true, timeout: 15_000 });
    await browser.keys(['Control', 'z']);

    await canvas.waitForCard('Undo by keyboard');
  });

  it('restores from the trash panel', async () => {
    await seed('Restore from panel');
    await canvas.deleteNote('Restore from panel');
    await canvas.waitForNoCard('Restore from panel');
    await undoBar.dismiss();

    await trash.open();
    expect(await trash.titles()).toContain('Restore from panel');
    await trash.restore('Restore from panel');
    await trash.close();

    await canvas.waitForCard('Restore from panel');
  });

  it('purges for good, which the retention no longer protects', async () => {
    await seed('Purge me');
    await canvas.deleteNote('Purge me');
    await canvas.waitForNoCard('Purge me');
    await undoBar.dismiss();

    await trash.open();
    await trash.purge('Purge me');
    await browser.pause(500);
    expect(await trash.titles()).not.toContain('Purge me');
    await trash.close();

    expect((await bridge.listTrash()).map((row) => row.title)).not.toContain('Purge me');
  });
});
