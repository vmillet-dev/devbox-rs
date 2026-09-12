import { expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { editor } from '../pageobjects/editor.page.js';
import { spaces } from '../pageobjects/overlays.page.js';
import { reloadCanvas } from '../support/app.js';
import { bridge, draft, firstSpaceId, query } from '../support/bridge.js';

/**
 * Every field goes through one `applyPatch`, whose comparator table decides what
 * actually moved. What a unit spec cannot see is the wire: an omitted key must stay
 * omitted, and `targetSpaceId` is the one argument Tauri renames between the two
 * sides.
 */
describe('Editing a note', () => {
  const title = 'Kubernetes rollout';
  let spaceId = '';
  let refugeId = '';

  before(async () => {
    await canvas.open();
    spaceId = await firstSpaceId();
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

  it('changes the language through the generated union', async () => {
    await canvas.openNote(title);
    await editor.setLanguage('sh');
    await editor.close();

    expect((await reread())?.language).toBe('sh');
  });

  it('adds and removes a tag, normalised by Rust', async () => {
    await canvas.openNote(title);
    // The leading `#` is stripped and the case-insensitive duplicate collapsed,
    // in `notes::model::normalize_tags` and nowhere else.
    await editor.addTag('#deploy');
    await editor.addTag('Deploy');
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

    // Read back in local time, and late in the day: midnight would make a note
    // dated today expired the moment it was saved.
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
});
