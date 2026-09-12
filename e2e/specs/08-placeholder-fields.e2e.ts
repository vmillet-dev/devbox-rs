import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { fieldsForm } from '../pageobjects/overlays.page.js';
import { variables, settings } from '../pageobjects/titlebar.page.js';
import { reloadCanvas } from '../support/app.js';
import { bridge, draft, firstSpaceId, query } from '../support/bridge.js';

/**
 * A `{{field}}` is decided in `notes::placeholder` and nowhere else, its value is
 * kept in a table of its own, and a global variable only ever *proposes* one. The
 * last part is the one a unit suite cannot see: the proposal reaches the card as
 * the field's `defaultValue`, and copying it into `value` would freeze it.
 */
describe('{{fields}} in a snippet', () => {
  const title = 'Connect to the database';
  const body = 'psql -h {{host}} -p {{port=5432}} -U {{user}}';

  before(async () => {
    await canvas.open();
    const spaceId = await firstSpaceId();
    await bridge.createNote(draft({ spaceId, title, content: body, language: 'sh' }));
    await reloadCanvas();
    await canvas.waitForCard(title);
  });

  async function reread() {
    const view = await bridge.queryNotes(query({ search: title }));
    return view.sections[0]?.notes[0];
  }

  it('finds the three fields, and only those', async () => {
    const names = (await reread())?.placeholders.map((field) => field.name);
    expect(names).toEqual(['host', 'port', 'user']);
  });

  it('shows the ⚡ affordance on the card instead of a plain copy', async () => {
    const card = await canvas.cardWithTitle(title);
    expect(await card.$('[data-testid="note-card-fields"]').isExisting()).toBe(true);
    expect(await card.$('[data-testid="note-card-fill"]').isExisting()).toBe(true);
  });

  it('carries the default written in the text, as a suggestion', async () => {
    const port = (await reread())?.placeholders.find((field) => field.name === 'port');
    expect(port?.defaultValue).toBe('5432');
  });

  it('keeps what was typed into the form', async () => {
    const card = await canvas.cardWithTitle(title);
    await card.$('[data-testid="note-card-fill"]').click();
    await fieldsForm.form().waitForExist({ timeout: 10_000 });

    await fieldsForm.field('host').setValue('db.internal');
    await fieldsForm.field('user').setValue('reader');
    await fieldsForm.submit();
    await browser.pause(800);

    const fields = (await reread())?.placeholders ?? [];
    expect(fields.find((field) => field.name === 'host')?.value).toBe('db.internal');
    expect(fields.find((field) => field.name === 'user')?.value).toBe('reader');
  });

  it('does not refresh updated_at, which the canvas sorts on', async () => {
    // Filling a field is not aimed at the note: `set_placeholder_values` has a
    // command of its own precisely so it does not take the patch path.
    const before = (await reread())?.updatedAt;
    const card = await canvas.cardWithTitle(title);
    await card.$('[data-testid="note-card-fill"]').click();
    await fieldsForm.form().waitForExist({ timeout: 10_000 });
    await fieldsForm.field('host').setValue('db.other');
    await fieldsForm.submit();
    await browser.pause(800);

    expect((await reread())?.updatedAt).toBe(before);
  });

  it('lets a global variable propose a value without freezing it', async () => {
    await variables.open();
    await variables.add('port', '6543');
    await settings.close();
    await reloadCanvas();

    const port = (await reread())?.placeholders.find((field) => field.name === 'port');
    // The proposal arrives as the default, not as the stored value — the day the
    // variable changes, the note follows.
    expect(port?.defaultValue).toBe('6543');
    expect(port?.value).toBe('');
    expect(await bridge.listGlobalPlaceholders()).toEqual({ port: '6543' });
  });
});
