import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { spaces } from '../pageobjects/overlays.page.js';
import { press, reloadCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId, query } from '../support/bridge.js';

/**
 * `notes.space_id` carries `ON DELETE CASCADE`, so deleting a space without a refuge
 * would take its notes with it. The refuge is enforced in the model and in the schema;
 * only a real database proves the cascade never fires.
 */
describe('Spaces', () => {
  let homeId = '';

  before(async () => {
    await canvas.open();
    homeId = await homeSpaceId();

    // ⚠️ The first scenario asserts on "the only space there is", which is a property of
    // the **whole database** — and one application serves the whole run, so an earlier
    // spec file's space is still there. The precondition is established here rather than
    // inherited, which also makes this file runnable on its own.
    for (const space of await bridge.listSpaces()) {
      if (space.id !== homeId) {
        await bridge.deleteSpace(space.id, homeId);
      }
    }
    await reloadCanvas();
  });

  /**
   * The canvas is left filtered on a space this file then deletes, and the active space
   * outlives the page. Every later file asserts on titles, so it is put back on "all
   * spaces" here rather than each of them guessing what this one left behind.
   */
  after(async () => {
    await spaces.open();
    await spaces.allOption().click();
    await reloadCanvas();
  });

  it('refuses to delete the only space there is', async () => {
    await spaces.open();
    await browser.$('[data-testid="space-edit"]').click();

    expect(await spaces.deleteBlocked().isExisting()).toBe(true);
    await press('Escape');
    await spaces.close();
  });

  it('creates a space from the switcher', async () => {
    await spaces.open();
    await spaces.create('Veille');
    await browser.pause(500);

    const all = await bridge.listSpaces();
    expect(all.map((space) => space.name)).toContain('Veille');
  });

  it('lists both in the switcher, by name', async () => {
    await spaces.open();
    expect(await spaces.names()).toContain('Veille');
    await spaces.close();
  });

  it('renames one without touching its id', async () => {
    const before = (await bridge.listSpaces()).find((space) => space.name === 'Veille');
    await spaces.open();
    await spaces.rename(before!.id, 'Lectures');
    await browser.pause(500);

    const after = (await bridge.listSpaces()).find((space) => space.id === before!.id);
    expect(after?.name).toBe('Lectures');
  });

  it('filters the canvas down to the active space', async () => {
    const target = (await bridge.listSpaces()).find((space) => space.name === 'Lectures')!;
    await bridge.createNote(draft({ spaceId: target.id, title: 'Only in Lectures' }));
    await reloadCanvas();

    await spaces.open();
    await spaces.option(target.id).click();
    await canvas.waitForCard('Only in Lectures');
    expect(await canvas.titles()).toEqual(['Only in Lectures']);

    // The switcher wears the space it is filtering on, which is the only thing on
    // screen saying the canvas is not showing everything.
    expect(await spaces.label()).toContain('Lectures');
  });

  it('moves the notes out before dropping the space', async () => {
    const target = (await bridge.listSpaces()).find((space) => space.name === 'Lectures')!;
    await spaces.open();
    await spaces.remove(target.id, homeId);
    await browser.pause(800);

    expect((await bridge.listSpaces()).map((space) => space.name)).not.toContain('Lectures');

    // The note survived, in the refuge — a cascade would have taken it.
    const view = await bridge.queryNotes(query({ search: 'Only in Lectures' }));
    expect(view.matched).toBe(1);
    expect(view.sections[0]?.notes[0]?.spaceId).toBe(homeId);
  });
});
