import { expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { editor } from '../pageobjects/editor.page.js';
import { reopenSession } from '../support/app.js';
import { bridge, query } from '../support/bridge.js';

/**
 * Creating a note writes nothing until it is worth saving, and the editor commits on
 * the way out. Both are front-end rules about a row in SQLite — only a running
 * application can say whether they met.
 */
describe('Creating a note, and finding it again', () => {
  const title = 'Rotate the staging certificate';
  const body = 'openssl req -new -key staging.key -out staging.csr';
  let corpusBefore = 0;

  before(canvas.open);

  it('opens a draft that is not yet a row', async () => {
    corpusBefore = (await bridge.queryNotes(query())).matched;
    await canvas.createSnippet();

    const during = await bridge.queryNotes(query());
    expect(during.matched).toBe(corpusBefore);
  });

  it('persists the note once it carries something worth keeping', async () => {
    await editor.setTitle(title);
    await editor.setBody(body);
    await editor.close();

    await canvas.waitForCard(title);
    const view = await bridge.queryNotes(query({ search: title }));
    expect(view.matched).toBe(1);
  });

  it('materialises the draft exactly once, not once per committed field', async () => {
    // Closing commits the title, then the content, with no change detection between the
    // two: the second call still carries DRAFT_ID while the row already exists, and
    // `draftMaterialisedAs` is what redirects it. Without that, the corpus would have
    // grown by two.
    expect((await bridge.queryNotes(query())).matched).toBe(corpusBefore + 1);
  });

  it('opens the same draft from the ghost card at the end of the week section', async () => {
    // The `week` section is always emitted precisely so this card has a home.
    await canvas.createFromGhost();
    expect(await editor.isOpen()).toBe(true);
    await editor.close();

    // Still a draft nothing kept: closing an untouched one writes no row.
    expect((await bridge.queryNotes(query())).matched).toBe(corpusBefore + 1);
  });

  it('offers the same thing from the kind menu as from the split button', async () => {
    await canvas.createSnippetFromMenu();
    expect(await editor.isOpen()).toBe(true);
    await editor.close();
    expect((await bridge.queryNotes(query())).matched).toBe(corpusBefore + 1);
  });

  it('reads the note back from the database on a fresh front end', async () => {
    // ⚠️ Not a process restart — see `reopenSession`. What this proves is that the
    // canvas renders what the commands answer, not something a signal was still
    // holding: Angular and every store are built again from nothing.
    await reopenSession();

    await canvas.waitForCard(title);
    const view = await bridge.queryNotes(query({ search: title }));
    expect(view.matched).toBe(1);

    const section = view.sections[0];
    const note = section?.notes[0];
    expect(note?.title).toBe(title);
    expect(note?.content).toBe(body);
  });
});
