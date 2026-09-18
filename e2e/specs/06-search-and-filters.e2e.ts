import { $, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { blur, cursorOf, press, reloadCanvas, testid, waitForCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId } from '../support/bridge.js';

/**
 * Filtering, grouping and facet aggregation all run in Rust. What crosses the bridge here
 * is the query itself — the debounce, the local-day offset, and an exhaustive section set.
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

  // ⚠️ `unstyled-control` is `all: unset` and `cursor` is inherited, so a field takes its
  // parent's arrow. The `<label>` is the visible box here.
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
    // `LOWER()` without ICU only folds ASCII, which is why matching runs on the fetched
    // rows and not in the WHERE clause.
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
    // Searched here rather than inherited: an `it` that depends on the previous one
    // cannot be run or reordered alone.
    await canvas.search('étape');
    expect(await canvas.sectionKeys()).toEqual(['results']);
  });

  it('says so when nothing matches', async () => {
    await canvas.search('nothing matches this');
    expect(await canvas.noResults().isExisting()).toBe(true);
  });

  /**
   * ⚠️ An empty state that only reports is a dead end: the one thing to do from here is the
   * thing that emptied it, and `clearFilters()` was already sitting there unoffered.
   */
  it('offers the way out of the state that emptied it', async () => {
    await canvas.search('nothing matches this');

    await $(testid('canvas-clear-filters')).click();
    await waitForCanvas();

    expect(await canvas.searchQuery()).toBe('');
    expect(await canvas.noResults().isExisting()).toBe(false);
  });

  /** How big is this result, and why is that card in it. */
  describe('what a search says about itself', () => {
    /**
     * ⚠️ Mocha runs a suite's own tests before its nested suites, so this block is the
     * last thing in the file whatever its position — and a search left in the field is a
     * search the next spec file inherits.
     */
    after(async () => {
      await canvas.clearSearch();
    });

    it('counts the results, and says zero rather than going quiet', async () => {
      await canvas.search('Docker');
      // Against what is on screen: the corpus is shared with every file that ran before.
      expect(await canvas.matchedCount()).toContain(String((await canvas.titles()).length));

      // ⚠️ In words, not as a digit. French keeps the singular at zero, so "0 résultat"
      // would read as one — the count says "aucun résultat" instead, and this asserts the
      // meaning rather than a character.
      await canvas.search('nothing matches this');
      expect(await canvas.matchedCount()).toContain('aucun');
    });

    it('hides the count again once nothing is being filtered', async () => {
      await canvas.clearSearch();
      expect(await $(testid('search-matched')).isExisting()).toBe(false);
    });

    it('drops the search, the tag and the language in one click', async () => {
      await canvas.search('Docker');
      await canvas.toggleTag('ops');
      await canvas.toggleLanguage('sh');

      await $(testid('search-matched')).click();
      await canvas.open();

      expect(await $(testid('search-input')).getValue()).toBe('');
      expect(await $(testid('search-matched')).isExisting()).toBe(false);
      expect(await canvas.tagPill('ops').getAttribute('aria-pressed')).toBe('false');
      expect(await canvas.languageChip('sh').getAttribute('aria-pressed')).toBe('false');
    });

    it('does the same on Escape, once there is no selection to clear', async () => {
      await canvas.search('Docker');
      // ⚠️ Focus has to leave the field: the canvas keyboard ignores a keystroke aimed at
      // an input, which is what leaves Ctrl+K and typing alone.
      await blur();
      await press('Escape');
      await canvas.open();

      expect(await $(testid('search-matched')).isExisting()).toBe(false);
    });

    it('quotes the line that matched rather than the head of the body', async () => {
      const spaceId = await homeSpaceId();
      await bridge.createNote(
        draft({
          spaceId,
          title: 'Deployment runbook',
          // The needle is on the last line: a preview of the first three explains nothing.
          content: ['# preamble', 'nothing to see', 'still nothing', '  helm upgrade gateway'].join(
            String.fromCharCode(10),
          ),
          language: 'sh',
        }),
      );
      await reloadCanvas();

      await canvas.search('helm');
      const card = await canvas.cardWithTitle('Deployment runbook');
      // Trimmed of its indentation: a card shows one line and it starts with the code.
      expect(await card.$('.card-snippet').getText()).toBe('helm upgrade gateway');
    });

    it('quotes the tag when that is what matched, since no preview ever showed it', async () => {
      await canvas.search('db');
      const card = await canvas.cardWithTitle('Étape de migration');
      expect(await card.$(testid('note-card-hit')).getText()).toContain('db');
    });

    it('quotes nothing when the title is what matched, the card showing it already', async () => {
      await canvas.search('Docker');
      const card = await canvas.cardWithTitle('Docker compose');
      expect(await card.$(testid('note-card-hit')).isExisting()).toBe(false);
      // Back to the head of the body, which is what the card shows outside a search.
      expect(await card.$('.card-snippet').getText()).toContain('docker compose up -d');
    });
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
    await canvas.toggleTag('ops');
    expect((await canvas.titles()).sort()).toEqual(['Docker compose', 'Pinned reference']);
    await canvas.toggleTag('ops');
  });

  it('filters on a language from the rail', async () => {
    await canvas.toggleLanguage('sql');
    expect(await canvas.titles()).toEqual(['Étape de migration']);
    await canvas.toggleLanguage('sql');
  });

  it('keeps the quick filters chronological, unlike a facet', async () => {
    await canvas.applyFilter('pinned');

    const titles = await canvas.titles();
    expect(titles).toContain('Pinned reference');
    expect(titles).not.toContain('Docker compose');
    // A quick filter keeps the chronological shape; only a search or a facet flattens it.
    expect(await canvas.sectionKeys()).not.toContain('results');
    await canvas.applyFilter('all');
  });
});
