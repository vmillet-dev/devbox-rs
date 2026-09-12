import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { banners, titlebar } from '../pageobjects/titlebar.page.js';
import { bridge } from '../support/bridge.js';

/**
 * The one scenario neither unit suite can reach: a database file that does not
 * exist yet. Migrations run against a real path, the seeding guards decide, and
 * the front end boots far enough to render what came back.
 */
describe('First launch', () => {
  before(canvas.open);

  it('opens on a window wearing the application name', async () => {
    // From `Cargo.toml` through `APP_METADATA`, not from `tauri.conf.json`'s
    // lowercase product name.
    expect(await titlebar.title()).toBe('DevBox');
  });

  it('seeds one space and four sample notes', async () => {
    const spaces = await bridge.listSpaces();
    expect(spaces).toHaveLength(1);

    expect(await canvas.cards().length).toBe(4);
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

  it('boots without an error banner', async () => {
    // NG0203, a missing capability and a failed migration all land here.
    expect(await banners.error().isExisting()).toBe(false);
  });
});
