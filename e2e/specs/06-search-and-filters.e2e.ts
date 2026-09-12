import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { reloadCanvas } from '../support/app.js';
import { bridge, draft, firstSpaceId } from '../support/bridge.js';

/**
 * Filtering, grouping and facet aggregation all run in Rust; the front end only
 * describes the query. What crosses the bridge here is the query itself — the
 * debounce, the local-day offset, and a section set that must stay exhaustive.
 */
describe('Search, filters and facets', () => {
  before(async () => {
    await canvas.open();
    const spaceId = await firstSpaceId();
    await bridge.createNote(
      draft({
        spaceId,
        title: 'Étape de migration',
        content: 'ALTER TABLE notes',
        language: 'sql',
        tags: ['db'],
      }),
    );
    await bridge.createNote(
      draft({
        spaceId,
        title: 'Docker compose',
        content: 'docker compose up -d',
        language: 'sh',
        tags: ['ops'],
      }),
    );
    await bridge.createNote(draft({ spaceId, title: 'Pinned reference', pinned: true, tags: ['ops'] }));
    await reloadCanvas();
  });

  it('matches on the title, past the debounce', async () => {
    await canvas.search('Docker');
    expect(await canvas.titles()).toEqual(['Docker compose']);
  });

  it('matches on the body too', async () => {
    await canvas.search('ALTER TABLE');
    expect(await canvas.titles()).toEqual(['Étape de migration']);
  });

  it('folds case the way Rust does, not the way SQLite would', async () => {
    // `LOWER()` without ICU only folds ASCII, which is why matching is done on the
    // fetched rows and not in the WHERE clause.
    await canvas.search('étape');
    expect(await canvas.titles()).toEqual(['Étape de migration']);
  });

  it('collapses to a single flat results section while searching', async () => {
    expect(await canvas.sectionKeys()).toEqual(['results']);
  });

  it('says so when nothing matches', async () => {
    await canvas.search('nothing matches this');
    expect(await canvas.noResults().isExisting()).toBe(true);
  });

  it('goes back to the chronological sections when the search is cleared', async () => {
    await canvas.clearSearch();
    const keys = await canvas.sectionKeys();
    expect(keys).not.toContain('results');
    // `week` is always emitted: it hosts the create-ghost card.
    expect(keys).toContain('week');
  });

  it('filters on a tag from the rail', async () => {
    await canvas.tagPill('ops').click();
    await browser.pause(500);
    expect((await canvas.titles()).sort()).toEqual(['Docker compose', 'Pinned reference']);
    await canvas.tagPill('ops').click();
    await browser.pause(500);
  });

  it('filters on a language from the rail', async () => {
    await canvas.languageChip('sql').click();
    await browser.pause(500);
    expect(await canvas.titles()).toEqual(['Étape de migration']);
    await canvas.languageChip('sql').click();
    await browser.pause(500);
  });

  it('keeps the quick filters chronological, unlike a facet', async () => {
    await canvas.filter('pinned').click();
    await browser.pause(500);

    const titles = await canvas.titles();
    expect(titles).toContain('Pinned reference');
    expect(titles).not.toContain('Docker compose');
    // A quick filter keeps the chronological shape; only a search or a facet flattens it.
    expect(await canvas.sectionKeys()).not.toContain('results');
    await canvas.filter('all').click();
    await browser.pause(500);
  });
});
