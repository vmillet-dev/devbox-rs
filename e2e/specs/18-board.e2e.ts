import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { board, folders, spaces } from '../pageobjects/overlays.page.js';
import { eventually, reloadCanvas, testid, waitForCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId, query } from '../support/bridge.js';

/**
 * The board is drawn from geometry a real database stores, and the first layout is
 * materialised on the first read — only a real one proves it comes back unchanged.
 *
 * ⚠️ A space of its own, and not the home one: seventeen spec files have run before this
 * and left their notes there, so "the loose cards are exactly these" would be a claim
 * about the whole corpus. The e2e run shares one process and one database.
 */
describe('The board', () => {
  let homeId = '';
  let spaceId = '';
  let perfId = '';

  /** ⚠️ The active space is front-end state, so a refresh drops it back to "all spaces". */
  async function reloadInSpace(id = spaceId): Promise<void> {
    await reloadCanvas();
    await spaces.open();
    await spaces.option(id).click();
    await waitForCanvas();
  }

  before(async () => {
    await canvas.open();
    homeId = await homeSpaceId();
    spaceId = (await bridge.createSpace({ name: 'Tableau' })).id;

    perfId = (await bridge.createFolder({ spaceId, name: 'Perf' })).id;
    await bridge.createFolder({ spaceId, name: 'Migrations' });

    const filed = await bridge.createNote(draft({ spaceId, title: 'EXPLAIN lent sur join' }));
    await bridge.fileNotes([filed.id], perfId);
    await bridge.createNote(draft({ spaceId, title: 'Dump nocturne' }));

    await reloadInSpace();
  });

  after(async () => {
    await board.show('date');
    // Takes its folders with it through the cascade, and its notes to the refuge.
    await bridge.deleteSpace(spaceId, homeId);
    await reloadCanvas();
    await spaces.open();
    await spaces.allOption().click();
    await reloadCanvas();
  });

  it('starts on the date view, which stays the default', async () => {
    expect(await board.isShowing()).toBe(false);
    expect(await board.pressed('date')).toBe('true');
  });

  /** ⚠️ A folder belongs to a space, so there would be no zones to draw. */
  it('offers no board while the user is on all spaces', async () => {
    await spaces.open();
    await spaces.allOption().click();
    await waitForCanvas();

    expect(await board.option('board').isEnabled()).toBe(false);

    await spaces.open();
    await spaces.option(spaceId).click();
    await waitForCanvas();
  });

  it('draws every folder as a zone holding its notes, the loose ones beside them', async () => {
    await board.show('board');

    expect(await board.zoneNames()).toEqual(['Perf', 'Migrations']);
    expect(await board.zoneTitles('Perf')).toEqual(['EXPLAIN lent sur join']);
    expect(await board.zoneTitles('Migrations')).toEqual([]);
    expect(await board.looseTitles()).toEqual(['Dump nocturne']);
  });

  /** A card is the same card in both views — full size, tag, snippet, footer and all. */
  it('draws the same card the canvas draws', async () => {
    const card = await board.zoneCard('Perf', 'EXPLAIN lent sur join');

    expect(await card.$(testid('note-card-title')).isExisting()).toBe(true);
    expect(await card.$(testid('note-card-open')).isExisting()).toBe(true);
  });

  /** ⚠️ Dimmed in place: reflowing throws away the only thing the board has. */
  it('dims what a search does not match rather than removing it', async () => {
    await canvas.search('EXPLAIN');
    await browser.pause(600);

    expect(await board.zoneTitles('Perf')).toEqual(['EXPLAIN lent sur join']);
    expect(await board.looseTitles()).toEqual(['Dump nocturne']);
    expect(await board.isDimmed('Dump nocturne')).toBe(true);
    expect(await board.isDimmed('EXPLAIN lent sur join')).toBe(false);

    await canvas.clearSearch();
    await eventually(
      () => board.isDimmed('Dump nocturne'),
      (dimmed) => !dimmed,
      'the card stayed dimmed after the search was cleared',
    );
  });

  /** The board would look shuffled at every launch otherwise. */
  it('keeps its layout across a restart of the front end', async () => {
    const before = await board.zoneFrames();
    expect(before).toHaveLength(2);

    await reloadInSpace();
    await board.waitForBoard();

    expect(await board.zoneFrames()).toEqual(before);
  });

  it('lays a zone out beside the others rather than on top of them', async () => {
    const frames = await board.zoneFrames();

    expect(frames[0]!.left).not.toBe(frames[1]!.left);
  });

  /** It comes back on the board because the preference is written down, per space. */
  it('comes back on the board after a restart of the front end', async () => {
    await reloadInSpace();

    await board.waitForBoard();
    expect(await board.isShowing()).toBe(true);
  });

  /** Per space, so arranging one does not switch the others. */
  it('remembers the chosen view space by space', async () => {
    await spaces.open();
    await spaces.option(homeId).click();
    await waitForCanvas();
    expect(await board.isShowing()).toBe(false);

    await spaces.open();
    await spaces.option(spaceId).click();
    await board.waitForBoard();
    expect(await board.isShowing()).toBe(true);
  });

  it('leaves the date view exactly as it was when it switches back', async () => {
    await board.show('date');

    await canvas.waitForCard('Dump nocturne');
    expect((await canvas.titles()).sort()).toEqual(['Dump nocturne', 'EXPLAIN lent sur join']);
    expect((await canvas.sectionKeys()).length).toBeGreaterThan(0);

    await board.show('board');
  });

  /**
   * ⚠️ A card on the board is the same card, so its checkboxes are real ones — and the
   * board has to hear about the write, which used to reload the canvas and nothing else.
   */
  it('ticks a todo list on the board, and shows it ticked without a view switch', async () => {
    const list = await bridge.createNote(
      draft({
        spaceId,
        title: 'Avant la release',
        kind: 'checklist',
        items: [
          { text: 'Tag', done: false },
          { text: 'Notes', done: false },
        ],
      }),
    );
    await reloadInSpace();
    await board.show('board');
    await board.waitForBoard();

    const card = browser.$(`${testid('note-card')}[data-note-id="${list.id}"]`);
    await card.$(testid('note-card-item')).click();
    await browser.pause(900);

    const view = await bridge.queryNotes(query({ spaceId, search: 'Avant la release' }));
    expect(view.sections[0]?.notes[0]?.items?.[0]?.done).toBe(true);
    // Drawn from what the board re-read, not from the date view behind it.
    expect(await card.$(testid('note-card-item')).getAttribute('aria-checked')).toBe('true');
  });

  /**
   * ⚠️ The grip used to be drawn on top of the selection tick, with an opaque background
   * and a higher `z-index`, so ticking a card on the board meant aiming at the few pixels
   * of checkbox that stuck out from under it. There is no grip at all now — the card is
   * its own handle — and the corner is the tick's.
   */
  it('leaves the corner to the selection tick, having no grip left', async () => {
    await board.show('board');
    expect(await browser.$(testid('board-card-grip')).isExisting()).toBe(false);

    await canvas.check('Dump nocturne');
    expect(await canvas.isChecked('Dump nocturne')).toBe(true);

    await canvas.check('Dump nocturne');
    expect(await canvas.isChecked('Dump nocturne')).toBe(false);
  });

  /** Nothing is removed from the header: the board is a second view, not a replacement. */
  it('keeps the folder switcher and the rails working beside it', async () => {
    await folders.open();
    expect(await folders.names()).toContain('Perf');
    await folders.close();
  });
});
