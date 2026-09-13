import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { banners, fileMenu, titlebar } from '../pageobjects/titlebar.page.js';
import { bridge, homeSpaceId } from '../support/bridge.js';

/**
 * The one scenario neither unit suite can reach: a database file that does not exist
 * yet. Migrations run against a real path, the seeding guards decide, and the front end
 * boots far enough to render what came back.
 *
 * ⚠️ This file is also the only one that meets a **virgin** profile, and the rest of the
 * run depends on that: `homeSpaceId()` resolves the seeded space here, while there is
 * still exactly one, and writes it down for the eleven files that follow.
 */
describe('First launch', () => {
  before(canvas.open);

  it('opens on a window wearing the application name', async () => {
    // From `Cargo.toml` through `APP_METADATA`, not from `tauri.conf.json`'s lowercase
    // product name.
    expect(await titlebar.title()).toBe('DevBox');
  });

  it('seeds one space and four sample notes', async () => {
    const spaces = await bridge.listSpaces();
    expect(spaces).toHaveLength(1);

    expect(await canvas.cards().length).toBe(4);

    // Resolved while the guarantee above still holds; every later file reads it back.
    expect(await homeSpaceId()).toBe(spaces[0]?.id);
  });

  it('gives every card a click surface of its own', async () => {
    const card = await canvas.cardWithTitle((await canvas.titles())[0] ?? '');
    expect(await canvas.cardButton(card).isExisting()).toBe(true);
  });

  it('lights the untriaged filter, because exactly one sample carries a deadline', async () => {
    const everything = await canvas.titles();
    expect(everything).toHaveLength(4);

    await canvas.filter('untriaged').click();
    await browser.pause(400);

    // One of the four, not all four: a filter that filtered nothing would pass a
    // "more than zero" assertion.
    const untriaged = await canvas.titles();
    expect(untriaged).toHaveLength(1);
    expect(everything).toContain(untriaged[0]);

    await canvas.filter('all').click();
    await browser.pause(400);
    expect(await canvas.titles()).toHaveLength(4);
  });

  it('offers a way out of the application, which nothing here clicks', async () => {
    await fileMenu.open();
    // ⚠️ Presence only. Clicking it quits, and one application serves the whole run.
    expect(await fileMenu.quit().isExisting()).toBe(true);
    await fileMenu.open();
  });

  it('boots without an error banner', async () => {
    // NG0203, a missing capability and a failed migration all land here.
    expect(await banners.error().isExisting()).toBe(false);
  });
});
