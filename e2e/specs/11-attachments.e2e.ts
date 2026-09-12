import { browser, expect } from '@wdio/globals';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canvas } from '../pageobjects/canvas.page.js';
import { editor } from '../pageobjects/editor.page.js';
import { reloadCanvas } from '../support/app.js';
import { bridge, draft, firstSpaceId, query } from '../support/bridge.js';

/**
 * Attachment bytes are not in the database: the row holds a record and the file
 * lives under `app_data_dir()/attachments/` with a name derived from the record id.
 * Write order is load-bearing — copy the file, then insert — and only a real
 * directory can show it.
 *
 * ⚠️ The picker is not driven (see `support/app.ts`); `attach_file` takes the path
 * the picker would have returned.
 */
describe('Attachments', () => {
  const title = 'Note with a file';
  const directory = mkdtempSync(join(tmpdir(), 'devbox-e2e-'));
  const filePath = join(directory, 'runbook.txt');
  let noteId = '';

  before(async () => {
    writeFileSync(filePath, 'step one\nstep two\n');
    await canvas.open();
    const spaceId = await firstSpaceId();
    noteId = (await bridge.createNote(draft({ spaceId, title }))).id;
    await reloadCanvas();
    await canvas.waitForCard(title);
  });

  async function attach(path: string) {
    return browser.executeAsync(
      (id: string, file: string, done: (value: unknown) => void) => {
        const tauri = (window as unknown as Record<string, any>)['__TAURI__'];
        tauri.core
          .invoke('attach_file', { noteId: id, path: file })
          .then((value: unknown) => done({ ok: value }))
          .catch((error: unknown) => done({ err: String(error) }));
      },
      noteId,
      path,
    ) as Promise<{ ok?: { id: string; fileName: string }; err?: string }>;
  }

  it('records the file and keeps its name', async () => {
    const outcome = await attach(filePath.replaceAll('\\', '/'));
    expect(outcome.err).toBeUndefined();
    expect(outcome.ok?.fileName).toBe('runbook.txt');

    const listed = await bridge.listAttachments(noteId);
    expect(listed.map((item) => item.fileName)).toEqual(['runbook.txt']);
  });

  it('counts on the card without opening the note', async () => {
    await reloadCanvas();
    const card = await canvas.cardWithTitle(title);
    expect(await card.$('[data-testid="note-card-clip"]').isExisting()).toBe(true);

    const view = await bridge.queryNotes(query({ search: title }));
    expect(view.sections[0]?.notes[0]?.attachmentCount).toBe(1);
  });

  it('lists it in the editor strip, and still does after a reopen', async () => {
    await canvas.openNote(title);
    await browser.$('[data-testid="attachment-item"]').waitForExist({ timeout: 10_000 });
    expect(await browser.$('[data-testid="attachment-item"]').getAttribute('data-file-name')).toBe(
      'runbook.txt',
    );

    await editor.close();
    await canvas.openNote(title);
    await browser.$('[data-testid="attachment-item"]').waitForExist({ timeout: 10_000 });
  });

  it('gives two files of the same name two records', async () => {
    // `model::stored_name` derives the stored name from the record id: two
    // `runbook.txt` must not overwrite each other on disk.
    const second = mkdtempSync(join(tmpdir(), 'devbox-e2e-'));
    const twin = join(second, 'runbook.txt');
    writeFileSync(twin, 'a different runbook\n');

    const outcome = await attach(twin.replaceAll('\\', '/'));
    expect(outcome.err).toBeUndefined();

    const listed = await bridge.listAttachments(noteId);
    expect(listed).toHaveLength(2);
    expect(new Set(listed.map((item) => item.id)).size).toBe(2);
  });

  it('removes one on the second click, and only then', async () => {
    await editor.close();
    await canvas.openNote(title);

    const remove = browser.$('[data-testid="attachment-remove"]');
    await remove.click();
    await browser.pause(400);
    expect(await bridge.listAttachments(noteId)).toHaveLength(2);

    await remove.click();
    await browser.pause(800);
    expect(await bridge.listAttachments(noteId)).toHaveLength(1);
  });
});
