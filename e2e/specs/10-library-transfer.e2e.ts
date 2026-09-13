import { browser, expect } from '@wdio/globals';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canvas } from '../pageobjects/canvas.page.js';
import { fileMenu } from '../pageobjects/titlebar.page.js';
import { press, reloadCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId, query } from '../support/bridge.js';

/**
 * Export and import compose the notes and spaces stores rather than owning a table,
 * and every operation reports — including when it changed nothing, which is the one
 * case indistinguishable from a failure without a report.
 *
 * ⚠️ The OS file picker is **not** driven here: `__TAURI_INTERNALS__.invoke` is
 * frozen, so nothing can stand in front of it, and a picker opened by a click would
 * block the application until a human clicked it (see `support/app.ts`). The
 * commands take a path, and the path is where the real work happens; what the menu
 * is asked here is only what it can answer without a dialog.
 */
describe('Import, export and share', () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbox-e2e-'));

  /**
   * Forward slashes for the command, which crosses JSON and lands in a Rust `Path`:
   * `\` is an escape on the wire and a separator on Windows. Node reads the same path
   * back with `/` on either platform, so nothing converts it a second time.
   */
  const bundlePath = join(directory, 'library.json').replaceAll('\\', '/');

  /** Kept from `before`: the seeded space is named from a translation (see below). */
  let homeId = '';

  before(async () => {
    await canvas.open();
    homeId = await homeSpaceId();
    await bridge.createNote(draft({ spaceId: homeId, title: 'Worth exporting', content: 'echo hello' }));
    await reloadCanvas();
  });

  it('writes every note to the bundle', async () => {
    // The sample corpus plus the note seeded above, in the one seeded space.
    const corpus = await bridge.queryNotes(query());
    const written = await bridge.exportNotes(bundlePath);
    expect(written.notes).toBe(corpus.matched);
    expect(written.spaces).toBe((await bridge.listSpaces()).length);

    expect(existsSync(bundlePath)).toBe(true);
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as { notes: { title: string }[] };
    expect(bundle.notes.map((note) => note.title)).toContain('Worth exporting');
  });

  it('imports nothing when every note is already there', async () => {
    const before = (await bridge.queryNotes(query())).matched;
    const report = await bridge.importNotes(bundlePath);

    // Correct, and the only reason it is not read as a failure is that the report
    // says so: every id in the bundle is already in the database.
    expect(report.notesImported).toBe(0);
    expect(report.notesSkipped).toBe(before);
    expect((await bridge.queryNotes(query())).matched).toBe(before);
  });

  it('brings a note back once it is really gone', async () => {
    const view = await bridge.queryNotes(query({ search: 'Worth exporting' }));
    const id = view.sections[0]?.notes[0]?.id;
    expect(id).toBeDefined();

    await bridge.deleteNote(id!);
    await browser.executeAsync((noteId: string, done: (value: unknown) => void) => {
      const tauri = (window as unknown as Record<string, any>)['__TAURI__'];
      tauri.core
        .invoke('purge_notes', { ids: [noteId] })
        .then(() => done(null))
        .catch(() => done(null));
    }, id!);

    const report = await bridge.importNotes(bundlePath);
    expect(report.notesImported).toBe(1);

    await reloadCanvas();
    await canvas.waitForCard('Worth exporting');
  });

  it('files an imported note into the existing space rather than a second one', async () => {
    const before = await bridge.listSpaces();
    // ⚠️ By identity, never by name: the seeded space is **translated**, and the
    // application opens in the system language — `Découverte` on a French machine,
    // `Getting started` on an English runner. A spec that spells the name passes at
    // home and fails on CI, which is exactly what it did.
    expect(before.some((space) => space.id === homeId)).toBe(true);

    // The bundle carries that space by name, and the database already has it:
    // matching is case-insensitive and by name, so nothing is created.
    const report = await bridge.importNotes(bundlePath);
    expect(report.spacesCreated).toBe(0);

    const after = await bridge.listSpaces();
    expect(after.map((space) => space.name)).toEqual(before.map((space) => space.name));

    const view = await bridge.queryNotes(query({ search: 'Worth exporting' }));
    expect(view.sections[0]?.notes[0]?.spaceId).toBe(homeId);
  });

  it('greys out the menu entries that have nothing to act on', async () => {
    await fileMenu.open();
    // Nothing is ticked, so there is no selection to export. The entry stays in the DOM
    // and clickable — it carries `aria-disabled`, not `disabled`.
    expect(await fileMenu.isDisabled('exportSelection')).toBe(true);
    expect(await fileMenu.isDisabled('exportAll')).toBe(false);

    // ⚠️ Neither is clicked: both open the OS file picker, which blocks the application
    // until a human answers it. The commands underneath are what the tests above drive.
    expect(await fileMenu.entry('exportAll').isExisting()).toBe(true);
    await press('Escape');
  });
});
