import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { cursorOf, reloadCanvas, testid } from '../support/app.js';
import { bridge, draft, homeSpaceId } from '../support/bridge.js';

/**
 * Filtering, grouping and facet aggregation all run in Rust; the front end only
 * describes the query. What crosses the bridge here is the query itself — the debounce,
 * the local-day offset, and a section set that must stay exhaustive.
 */
describe('Search, filters and facets', () => {
  before(async () => {
    await canvas.open();
    const spaceId = await homeSpaceId();
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

  // `unstyled-control` is `all: unset`, and `cursor` is inherited — so every field in
  // the app took its parent's arrow. The <label> is the visible box here, and clicking
  // its padding already focuses the input.
  it('says it can be typed into, on the whole box', async () => {
    expect(await cursorOf(testid('search-input'))).toBe('text');
    expect(await cursorOf('.search-bar')).toBe('text');
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

  it('folds the accents too, on both sides of the comparison', async () => {
    // Nobody reaches for the accent key to search, and the corpus is written with them.
    await canvas.search('etape');
    expect(await canvas.titles()).toEqual(['Étape de migration']);

    // Symmetric, because the needle goes through the same fold as the haystack.
    await canvas.search('Dôcker');
    expect(await canvas.titles()).toEqual(['Docker compose']);
  });

  it('collapses to a single flat results section while searching', async () => {
    // Searched here rather than inherited from the test above: an `it` that depends on
    // what the previous one left cannot be run, reordered or bailed on alone.
    await canvas.search('étape');
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

  it('shows a note its tags, on the card', async () => {
    await canvas.search('Docker');
    const card = await canvas.cardWithTitle('Docker compose');
    expect(await canvas.cardTags(card).getText()).toContain('ops');
    await canvas.clearSearch();
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
