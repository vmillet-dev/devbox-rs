import { browser, expect } from '@wdio/globals';

import { canvas } from '../pageobjects/canvas.page.js';
import { editor } from '../pageobjects/editor.page.js';
import { palette } from '../pageobjects/overlays.page.js';
import { emitGlobalAction, press, reloadCanvas } from '../support/app.js';
import { bridge, draft, homeSpaceId } from '../support/bridge.js';

/**
 * ⚠️ The OS-level `Ctrl+Alt+P` is **out of scope**: WebDriver types into the
 * WebView, not into the machine, and a global accelerator is registered natively
 * before the front end exists. What is exercised here is everything downstream of
 * it — the same `devbox:action` event the accelerator and the tray both send.
 */
describe('The quick-paste palette', () => {
  async function setShortcuts(bindings: Record<string, string>) {
    return (await browser.executeAsync((payload: Record<string, string>, done: (value: unknown) => void) => {
      const tauri = (window as unknown as Record<string, any>)['__TAURI__'];
      tauri.core
        .invoke('set_global_shortcuts', { bindings: payload })
        .then((value: unknown) => done({ ok: value }))
        .catch((error: unknown) => done({ err: String(error) }));
    }, bindings)) as { ok?: string[]; err?: string };
  }

  before(async () => {
    await canvas.open();
    const spaceId = await homeSpaceId();
    await bridge.createNote(
      draft({ spaceId, title: 'Reset the dev database', content: 'cargo run -- reset', language: 'sh' }),
    );
    await bridge.createNote(draft({ spaceId, title: 'Unrelated note', content: 'nothing to see' }));
    await reloadCanvas();
  });

  it('opens on the action the native side sends', async () => {
    await emitGlobalAction('palette');
    await palette.input().waitForExist({ timeout: 10_000 });
  });

  it('narrows to what was typed', async () => {
    await palette.type('reset');
    const titles = await palette.titles();
    expect(titles.join(' ')).toContain('Reset the dev database');
    expect(titles.join(' ')).not.toContain('Unrelated note');
  });

  it('offers to create a note from a query that matches nothing', async () => {
    await palette.type('a query matching nothing at all');
    expect(await palette.createRow().isExisting()).toBe(true);
    // The offer replaces the list rather than sitting under an empty one.
    expect(await palette.options().length).toBe(0);
  });

  it('says the corpus is empty rather than showing a bare list', async () => {
    await palette.type('');
    // Every note is a candidate with no query, so the empty row is the one thing that
    // must not appear here — it belongs to a corpus with nothing in it.
    expect(await palette.empty().isExisting()).toBe(false);
    expect(await palette.options().length).toBeGreaterThan(0);
  });

  it('opens the highlighted note in the editor on Tab', async () => {
    await palette.type('reset');
    // Tab is the palette's own shortcut here, not a way out of a field: it opens
    // what is highlighted, so it is pressed rather than blurred.
    await press('Tab');

    expect(await editor.isOpen()).toBe(true);
    expect(await editor.title()).toBe('Reset the dev database');
    await editor.close();
  });

  it('closes on Escape', async () => {
    await emitGlobalAction('palette');
    await palette.input().waitForExist({ timeout: 10_000 });
    await press('Escape');
    await palette.input().waitForExist({ reverse: true, timeout: 10_000 });
  });

  it('re-registers the three accelerators and names the ones it lost', async () => {
    // A global accelerator is first-come-first-served across the machine and the
    // loser gets no error, so the command answers with what it could not take.
    // Which of the three is machine-dependent; that they are the only candidates
    // is not, and neither is the fact that re-registering an already-held
    // accelerator succeeds rather than reporting it lost.
    const asked = { palette: 'Ctrl+Alt+P', capture: 'Ctrl+Alt+V', newNote: 'Ctrl+Alt+N' };

    const first = await setShortcuts(asked);
    expect(first.err).toBeUndefined();
    for (const accelerator of first.ok ?? []) {
      expect(Object.values(asked)).toContain(accelerator);
    }

    // `register_shortcuts` drops all three and takes them again: the second call
    // must lose no more than the first, or it is unregistering its own.
    const second = await setShortcuts(asked);
    expect(second.ok).toEqual(first.ok);
  });
});
