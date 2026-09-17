import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { crumb, folders, selectionBar, spaces } from '../pageobjects/overlays.page.js';
import { reloadCanvas, testid, waitForCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId, query } from '../support/bridge.js';

/**
 * `notes.folder_id` carries `ON DELETE SET NULL`, the one thing a folder must never get
 * wrong — and only a real database proves a delete leaves the notes standing.
 */
describe('Folders', () => {
  let homeId = '';

  /**
   * ⚠️ The active space is front-end state, so `browser.refresh()` drops it back to "all
   * spaces" — where the switcher offers no creation, a folder having nowhere to go. Every
   * reload here therefore settles back into the home space.
   */
  async function reloadInHomeSpace(): Promise<void> {
    await reloadCanvas();
    await spaces.open();
    await spaces.option(homeId).click();
    await waitForCanvas();
  }

  before(async () => {
    await canvas.open();
    homeId = await homeSpaceId();

    // Established, never inherited: one application serves the whole run.
    for (const folder of await bridge.listFolders()) {
      await bridge.deleteFolder(folder.id);
    }
    await reloadInHomeSpace();
  });

  after(async () => {
    for (const folder of await bridge.listFolders()) {
      await bridge.deleteFolder(folder.id);
    }
    await spaces.open();
    await spaces.allOption().click();
    await reloadCanvas();
  });

  it('creates a folder from the switcher', async () => {
    await folders.open();
    await folders.create('Migrations');
    await browser.pause(500);

    expect((await bridge.listFolders(homeId)).map((folder) => folder.name)).toEqual(['Migrations']);
  });

  /** Assigned rather than chosen, so two made back to back never come out the same. */
  it('gives the next one a different colour without being asked', async () => {
    await folders.open();
    await folders.create('Perf');
    await browser.pause(500);

    const made = await bridge.listFolders(homeId);
    expect(made.map((folder) => folder.name)).toEqual(['Migrations', 'Perf']);
    expect(made[0]?.colour).not.toBe(made[1]?.colour);
  });

  /** The rail is a tree, so a space folds away with its folders and comes back with them. */
  it('folds a space away without changing what is active', async () => {
    await spaces.collapse(homeId);
    expect(await folders.names()).not.toContain('Perf');

    await spaces.collapse(homeId);
    expect(await folders.names()).toContain('Perf');
  });

  it('refuses a second folder of the same name in one space', async () => {
    const refused = await bridge.createFolder({ spaceId: homeId, name: 'migrations' }).then(
      () => 'it was not refused',
      (error: Error) => error.message,
    );

    expect(refused).toContain('duplicateFolderName');
    expect(await bridge.listFolders(homeId)).toHaveLength(2);
  });

  describe('filing notes from the selection bar', () => {
    let perfId = '';

    before(async () => {
      perfId = (await bridge.listFolders(homeId)).find((folder) => folder.name === 'Perf')!.id;
      await bridge.createNote(draft({ spaceId: homeId, title: 'Locks sur jobs' }));
      await bridge.createNote(draft({ spaceId: homeId, title: 'Cache hit ratio' }));
      await reloadInHomeSpace();
    });

    it('files a whole selection in one gesture', async () => {
      await canvas.check('Locks sur jobs');
      await canvas.check('Cache hit ratio');
      await selectionBar.fileInto(perfId);
      await browser.pause(800);

      const view = await bridge.queryNotes(query({ spaceId: homeId, folderId: perfId }));
      expect(view.matched).toBe(2);
    });

    /** The back end resolves the folder; the card never joins an id against a list. */
    it('says on the card where the note lives', async () => {
      await selectionBar.clear();
      await reloadInHomeSpace();

      const card = await canvas.cardWithTitle('Locks sur jobs');
      expect(await card.$(testid('note-card-folder')).getText()).toContain('Perf');
    });

    /** ⚠️ The absence reads on its own; an "unfiled" chip would soil every loose card. */
    it('shows no chip at all on a note with no folder', async () => {
      await bridge.createNote(draft({ spaceId: homeId, title: 'Hors dossier' }));
      await reloadInHomeSpace();

      const card = await canvas.cardWithTitle('Hors dossier');
      expect(await card.$(testid('note-card-folder')).isExisting()).toBe(false);
    });

    /**
     * Choosing a folder *is* opening it: the canvas narrows and the breadcrumb takes the
     * switcher's place, because from inside a folder there is one place to go.
     */
    it('narrows the canvas to one folder, and back out again', async () => {
      await folders.open();
      await folders.option(perfId).click();
      await canvas.waitForNoCard('Hors dossier');

      expect((await canvas.titles()).sort()).toEqual(['Cache hit ratio', 'Locks sur jobs']);
      expect(await crumb.name()).toBe('Perf');

      await crumb.back();
      await canvas.waitForCard('Hors dossier');
      expect(await crumb.isShowing()).toBe(false);
    });

    /** The same control both ways: taking a note out is a filing with no folder. */
    it('takes a selection back out of its folder', async () => {
      await canvas.check('Cache hit ratio');
      await selectionBar.fileInto(null);
      await browser.pause(800);
      await selectionBar.clear();

      const view = await bridge.queryNotes(query({ spaceId: homeId, folderId: perfId }));
      expect(view.matched).toBe(1);
    });

    /** ⚠️ The chip would otherwise name a folder the space switcher can never reach. */
    it('unfiles a note carried off to another space', async () => {
      const elsewhere = await bridge.createSpace({ name: 'Ailleurs' });
      const id = await canvas.noteIdWithTitle('Locks sur jobs');

      await bridge.moveNotes([id], elsewhere.id);

      const view = await bridge.queryNotes(query({ spaceId: elsewhere.id }));
      expect(view.sections[0]?.notes[0]?.folderId ?? null).toBeNull();

      await bridge.deleteSpace(elsewhere.id, homeId);
      await reloadInHomeSpace();
    });
  });

  it('renames a folder and recolours it without touching its id', async () => {
    const before = (await bridge.listFolders(homeId)).find((folder) => folder.name === 'Migrations')!;

    await folders.open();
    await folders.rename(before.id, 'Schéma');
    await browser.pause(500);
    await folders.open();
    await folders.recolour(before.id, 'red');
    await browser.pause(500);

    const after = (await bridge.listFolders(homeId)).find((folder) => folder.id === before.id);
    expect(after?.name).toBe('Schéma');
    expect(after?.colour).toBe('red');
  });

  /**
   * The whole point of `ON DELETE SET NULL`: a folder is a label on a region, never a
   * container that takes its contents with it. A cascade here would be silent data loss.
   *
   * ⚠️ Seeds its own folder and note rather than reusing the ones above: Mocha runs a
   * nested suite after its siblings, so the filing block below has not run yet.
   */
  it('leaves every note standing when the folder goes', async () => {
    const doomed = await bridge.createFolder({ spaceId: homeId, name: 'Jetable' });
    const note = await bridge.createNote(draft({ spaceId: homeId, title: 'Survivante' }));
    await bridge.fileNotes([note.id], doomed.id);
    await reloadInHomeSpace();

    expect((await bridge.queryNotes(query({ spaceId: homeId, folderId: doomed.id }))).matched).toBe(1);
    const corpus = (await bridge.queryNotes(query({ spaceId: homeId }))).matched;

    await folders.open();
    await folders.remove(doomed.id);
    await browser.pause(800);

    expect((await bridge.listFolders(homeId)).map((folder) => folder.name)).not.toContain('Jetable');
    expect((await bridge.queryNotes(query({ spaceId: homeId }))).matched).toBe(corpus);

    // Standing, and now loose — the chip is what a `SET NULL` takes away.
    const view = await bridge.queryNotes(query({ search: 'Survivante' }));
    expect(view.matched).toBe(1);
    expect(view.sections[0]?.notes[0]?.folderId ?? null).toBeNull();
  });

  /** Its folders go with it through the cascade, and its notes come out of the refuge loose. */
  it('drops the folders of a deleted space and unfiles the notes it hands over', async () => {
    const doomed = await bridge.createSpace({ name: 'Éphémère' });
    const folder = await bridge.createFolder({ spaceId: doomed.id, name: 'Temporaire' });
    const note = await bridge.createNote(draft({ spaceId: doomed.id, title: 'Rescapée' }));
    await bridge.fileNotes([note.id], folder.id);

    await bridge.deleteSpace(doomed.id, homeId);

    expect(await bridge.listFolders(doomed.id)).toHaveLength(0);
    const view = await bridge.queryNotes(query({ search: 'Rescapée' }));
    expect(view.matched).toBe(1);
    expect(view.sections[0]?.notes[0]?.folderId ?? null).toBeNull();
    expect(view.sections[0]?.notes[0]?.spaceId).toBe(homeId);

    await reloadInHomeSpace();
  });
});
