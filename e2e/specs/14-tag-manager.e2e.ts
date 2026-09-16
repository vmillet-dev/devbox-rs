import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { tagManager } from '../pageobjects/overlays.page.js';
import { reloadCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId, query } from '../support/bridge.js';

/**
 * ⚠️ The rule under test lives in `notes::store::retag` and needs a real SQLite: the
 * primary key `(note_id, tag)` is `NOCASE`, so a rename onto an existing tag is a merge
 * and the target has to be swept along with the sources.
 */
describe('Managing the tags of the whole corpus', () => {
  let spaceId = '';

  before(async () => {
    await canvas.open();
    spaceId = await homeSpaceId();

    await bridge.createNote(draft({ spaceId, title: 'Tagged alpha', tags: ['staging'] }));
    await bridge.createNote(draft({ spaceId, title: 'Tagged beta', tags: ['staging', 'urgent'] }));
    await bridge.createNote(draft({ spaceId, title: 'Tagged gamma', tags: ['preprod'] }));
    await reloadCanvas();
    await canvas.waitForCard('Tagged alpha');
  });

  async function tagsOf(title: string) {
    const view = await bridge.queryNotes(query({ search: title }));
    return view.sections[0]?.notes[0]?.tags ?? [];
  }

  it('lists every tag in the corpus, with what uses it', async () => {
    await canvas.openTagManager();
    const listed = await tagManager.tags();
    expect(listed).toContain('staging');
    expect(listed).toContain('preprod');
    expect(listed).toContain('urgent');
  });

  it('needs a selection before it will apply anything', async () => {
    // Nothing ticked and no target: the action says so rather than acting on the corpus.
    expect(await tagManager.isApplyDisabled()).toBe(true);
  });

  /**
   * ⚠️ This acts on the whole library rather than on a selection, so a mis-click reaches
   * it easily — the count is what makes the confirmation worth reading.
   */
  it('states what it would touch, and writes nothing until that is accepted', async () => {
    await tagManager.select('staging');
    await tagManager.setTarget('recette');
    await tagManager.propose();

    await tagManager.confirmation().waitForDisplayed({ timeout: 10_000 });
    // Two notes carry `staging`, and the sentence has to say so.
    expect(await tagManager.confirmation().getText()).toContain('2');
    expect((await bridge.listTags()).map((usage) => usage.tag)).toContain('staging');

    await tagManager.cancel();
    await browser.pause(400);

    // Cancelling is the whole point of asking: nothing moved.
    expect(await tagsOf('Tagged alpha')).toEqual(['staging']);
  });

  it('renames a tag everywhere it is used', async () => {
    expect(await tagManager.isSelected('staging')).toBe(true);

    await tagManager.setTarget('recette');
    await tagManager.apply();
    await browser.pause(800);

    expect(await tagsOf('Tagged alpha')).toEqual(['recette']);
    expect((await tagsOf('Tagged beta')).sort()).toEqual(['recette', 'urgent']);
    // Untouched: a rename acts on what was selected, not on every tag.
    expect(await tagsOf('Tagged gamma')).toEqual(['preprod']);
  });

  it('merges rather than duplicating when the target already exists', async () => {
    // Reopened rather than continued: this test states its own selection.
    await reloadCanvas();
    await canvas.openTagManager();

    await tagManager.select('preprod');
    await tagManager.setTarget('recette');
    await tagManager.apply();
    await browser.pause(800);

    // `(note_id, tag)` is NOCASE, so the target is swept along with the sources.
    expect(await tagsOf('Tagged gamma')).toEqual(['recette']);
    expect(await tagsOf('Tagged alpha')).toEqual(['recette']);

    const corpus = (await bridge.listTags()).map((usage) => usage.tag);
    expect(corpus).not.toContain('preprod');
    expect(corpus).not.toContain('staging');
  });

  it('applies a pure case correction, which INSERT OR IGNORE would have dropped', async () => {
    await reloadCanvas();
    await canvas.openTagManager();

    await tagManager.select('recette');
    await tagManager.setTarget('Recette');
    await tagManager.apply();
    await browser.pause(800);

    // Same rows, different spelling: the value has to be rewritten rather than ignored
    // as a duplicate.
    expect(await tagsOf('Tagged alpha')).toEqual(['Recette']);
  });

  it('deletes a tag once the change is confirmed, leaving the notes alone', async () => {
    await reloadCanvas();
    await canvas.openTagManager();

    await tagManager.select('urgent');
    await tagManager.delete();
    await browser.pause(800);

    expect((await bridge.listTags()).map((usage) => usage.tag)).not.toContain('urgent');
    // The note survived its tag.
    expect(await tagsOf('Tagged beta')).toEqual(['Recette']);

    await tagManager.close();
  });

  it('does not refresh updated_at: a global retag is not aimed at a note', async () => {
    const before = (await bridge.queryNotes(query({ search: 'Tagged alpha' }))).sections[0]?.notes[0]
      ?.updatedAt;

    await bridge.renameTag('Recette', 'production');
    await browser.pause(400);

    const after = (await bridge.queryNotes(query({ search: 'Tagged alpha' }))).sections[0]?.notes[0];
    expect(after?.tags).toEqual(['production']);
    // The canvas sorts on that column and would float notes nobody reopened to the top.
    expect(after?.updatedAt).toBe(before);
  });
});
