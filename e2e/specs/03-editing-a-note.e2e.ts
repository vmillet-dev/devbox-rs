import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { editor } from '../pageobjects/editor.page.js';
import { spaces } from '../pageobjects/overlays.page.js';
import { reloadCanvas, viewportSize } from '../support/app.js';
import { bridge, draft, homeSpaceId, query } from '../support/bridge.js';

/**
 * Every field goes through one `applyPatch`, whose comparator table decides what
 * actually moved. What a unit spec cannot see is the wire: an omitted key must stay
 * omitted, and `targetSpaceId` is the one argument Tauri renames between the two sides.
 */
describe('Editing a note', () => {
  // ⚠️ Not a sample note's title. `reread()` takes the first hit of a search, so a title
  // shared with a seeded note makes the assertions depend on which of the two sorts
  // first — that is, on what an earlier spec file happened to touch.
  const title = 'Rollout under edit';
  let spaceId = '';
  let refugeId = '';

  before(async () => {
    await canvas.open();
    spaceId = await homeSpaceId();
    refugeId = (await bridge.createSpace({ name: 'Ops' })).id;
    await bridge.createNote(draft({ spaceId, title, content: 'kubectl rollout status' }));
    await reloadCanvas();
    await canvas.waitForCard(title);
  });

  async function reread() {
    const view = await bridge.queryNotes(query({ search: title }));
    return view.sections[0]?.notes[0];
  }

  it('writes title, body and source on the way out', async () => {
    await canvas.openNote(title);
    await editor.setBody('kubectl rollout restart deployment/api');
    await editor.setSource('runbooks/api.md');
    await editor.close();

    const note = await reread();
    expect(note?.content).toBe('kubectl rollout restart deployment/api');
    expect(note?.source).toBe('runbooks/api.md');
  });

  it('counts what the body holds, in the footer', async () => {
    await canvas.openNote(title);
    // Language label, lines and bytes — derived from the draft, so it is what tells a
    // reader the editor is looking at the note they opened.
    const footer = await editor.footer();
    expect(footer).toContain('1');
    await editor.close();
  });

  it('goes fullscreen and back, without losing the draft', async () => {
    await canvas.openNote(title);
    expect(await editor.isFullscreen()).toBe(false);

    const viewport = await viewportSize();
    const framed = await editor.panelSize();
    expect(framed.width).toBeLessThan(viewport.width);

    await editor.toggleFullscreen();
    expect(await editor.isFullscreen()).toBe(true);
    expect(await editor.body()).toBe('kubectl rollout restart deployment/api');

    // Measured, not asked: the button reported itself pressed while the panel was still
    // clamped to 92vw × 92vh, leaving a band of canvas that grew with the display.
    const full = await editor.panelSize();
    expect(full.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(full.height).toBeGreaterThanOrEqual(viewport.height - 1);

    await editor.toggleFullscreen();
    expect(await editor.isFullscreen()).toBe(false);
    await editor.close();
  });

  it('changes the language through the generated union', async () => {
    await canvas.openNote(title);
    await editor.setLanguage('sh');
    await editor.close();

    expect((await reread())?.language).toBe('sh');

    // A variant added to the Rust enum, through the select, the patch, the column and
    // back: the column stores the literal, so it takes no migration to get here.
    await canvas.openNote(title);
    await editor.setLanguage('rs');
    await editor.close();

    expect((await reread())?.language).toBe('rs');
  });

  it('adds and removes a tag, normalised by Rust', async () => {
    await canvas.openNote(title);
    // The leading `#` is stripped and the case-insensitive duplicate collapsed, in
    // `notes::model::normalize_tags` and nowhere else.
    await editor.addTag('#deploy');
    await editor.addTag('Deploy');
    expect(await editor.tags()).toEqual(['deploy']);
    await editor.close();
    expect((await reread())?.tags).toEqual(['deploy']);

    await canvas.openNote(title);
    await editor.removeTag('deploy');
    await editor.close();
    expect((await reread())?.tags).toEqual([]);
  });

  it('pins the note, and the card says so', async () => {
    await canvas.openNote(title);
    await editor.togglePin();
    expect(await editor.isPinned()).toBe(true);
    await editor.close();

    expect((await reread())?.pinned).toBe(true);
    const card = await canvas.cardWithTitle(title);
    expect(await card.$('[data-testid="note-card-pin"]').isExisting()).toBe(true);
  });

  it('sets a deadline at the end of the local day', async () => {
    await canvas.openNote(title);
    await editor.setDeadline('2030-06-15');
    await editor.close();

    const lifecycle = (await reread())?.lifecycle;
    expect(lifecycle?.kind).toBe('expires');

    // Read back in local time, and late in the day: midnight would make a note dated
    // today expired the moment it was saved.
    const at = new Date((lifecycle as { at: string }).at);
    expect(at.getFullYear()).toBe(2030);
    expect(at.getMonth()).toBe(5);
    expect(at.getDate()).toBe(15);
    expect(at.getHours()).toBeGreaterThan(12);
  });

  it('moves the note to another space, through the renamed argument', async () => {
    await canvas.moveNote(title, refugeId);
    await browser.pause(500);

    expect((await reread())?.spaceId).toBe(refugeId);
  });

  it('leaves the note reachable from the space it moved to', async () => {
    await spaces.open();
    await spaces.option(refugeId).click();
    await canvas.waitForCard(title);
  });

  it('shows every space again through the "all spaces" row', async () => {
    await spaces.open();
    await spaces.allOption().click();
    // `null` is a choice, not a loading state: the note filed in `Ops` is still listed.
    await canvas.waitForCard(title);

    // Reopened, because selecting closes the menu with the row that has to be checked.
    await spaces.open();
    expect(await spaces.allOption().getAttribute('aria-checked')).toBe('true');
    await spaces.close();
  });
});
