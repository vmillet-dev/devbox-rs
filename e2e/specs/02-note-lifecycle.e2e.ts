import { expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { editor } from '../pageobjects/editor.page.js';
import { restart } from '../support/app.js';
import { bridge, query } from '../support/bridge.js';

/**
 * Creating a note writes nothing until it is worth saving, and the editor commits
 * on the way out. Both are front-end rules about a row in SQLite — only a running
 * application can say whether they met.
 */
describe('Creating a note, and finding it after a restart', () => {
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
    // Closing commits the title, then the content, with no change detection
    // between the two: the second call still carries DRAFT_ID while the row
    // already exists, and `draftMaterialisedAs` is what redirects it. Without
    // that, the corpus would have grown by two.
    expect((await bridge.queryNotes(query())).matched).toBe(corpusBefore + 1);
  });

  it('still has it after the application is restarted', async () => {
    await restart();

    await canvas.waitForCard(title);
    const view = await bridge.queryNotes(query({ search: title }));
    expect(view.matched).toBe(1);

    const section = view.sections[0];
    const note = section?.notes[0];
    expect(note?.title).toBe(title);
    expect(note?.content).toBe(body);
  });
});
