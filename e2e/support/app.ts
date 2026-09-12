import { $, browser } from '@wdio/globals';

import type { GlobalAction } from '@core/ipc/bindings';

/** `[data-testid="…"]`, in one place, so a spec never spells the attribute. */
export function testid(name: string): string {
  return `[data-testid="${name}"]`;
}

export function byTestId(name: string): ChainablePromiseElement {
  return $(testid(name));
}

/**
 * The canvas is behind a lazy route, a `resource` and a debounce; every scenario
 * starts by waiting for it rather than for the window, which exists long before
 * anything is queryable.
 */
export async function waitForCanvas(): Promise<void> {
  await $(testid('canvas')).waitForExist({ timeout: 30_000 });
  await browser.waitUntil(async () => (await $(testid('canvas')).getAttribute('aria-busy')) !== 'true', {
    timeout: 30_000,
    timeoutMsg: 'the canvas never stopped loading',
  });
}

/**
 * A note written straight through the bridge is invisible to a canvas that has not
 * been told to re-query — `NotesRevision` is a front-end signal, and the back end
 * does not push. Reloading the page is the honest way to make seeded data appear.
 */
export async function reloadCanvas(): Promise<void> {
  await browser.refresh();
  await waitForCanvas();
}

/**
 * A real restart, database and preferences kept: `beforeSession` — which wipes the
 * profile — runs once per spec file, not per session, so a new session spawns a new
 * process against the same `app_data_dir()`. This is what makes "close it and it is
 * still there" mean anything.
 */
export async function restart(): Promise<void> {
  await browser.reloadSession();
  await waitForCanvas();
}

/**
 * The native side asks the front end for an action; the OS keystroke that normally
 * sends it cannot be typed through a WebView, so the event is emitted instead. What
 * is exercised is everything downstream of the accelerator.
 */
export async function emitGlobalAction(action: GlobalAction): Promise<void> {
  await browser.executeAsync((name: string, done: (value: unknown) => void) => {
    const tauri = (window as unknown as Record<string, any>)['__TAURI__'];
    tauri.event
      .emit('devbox:action', name)
      .then(() => done(null))
      .catch(() => done(null));
  }, action);
}

/**
 * What the application actually put on the system clipboard — or `null` when this
 * machine will not let anyone read it.
 *
 * ⚠️ On Windows the clipboard is a single global lock, and a clipboard manager (or
 * the history pane) can hold it indefinitely: the plugin then answers "held by
 * another party" to a read *and* to a write. That is a property of the runner, not
 * of DevBox, so a caller treats `null` as "not observable here" rather than as a
 * failure — and asserts on `DisplayNote.copyText`, which is the part DevBox owns.
 */
export async function clipboardText(): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const answer = (await browser.executeAsync((done: (value: unknown) => void) => {
      const tauri = (window as unknown as Record<string, any>)['__TAURI__'];
      tauri.core
        .invoke('plugin:clipboard-manager|read_text')
        .then((value: unknown) => done({ ok: typeof value === 'string' ? value : '' }))
        .catch((error: unknown) => done({ err: String(error) }));
    })) as { ok?: string; err?: string };

    if (answer.ok !== undefined) {
      return answer.ok;
    }
    await browser.pause(150);
  }
  return null;
}

/**
 * ⚠️ There is no way to stand in front of the OS file picker from here, and the
 * scenarios are written around that rather than against it.
 *
 * `window.__TAURI_INTERNALS__.invoke` — the single funnel every `invoke` goes
 * through, the application's own included — is defined `writable: false,
 * configurable: false`. Neither an assignment nor `Object.defineProperty` can wrap
 * it, which is deliberate hardening on Tauri's side; `browser.tauri.mock()` cannot
 * reach it either. So a picker opened by a click blocks the whole application until
 * a human clicks it.
 *
 * Consequence for the suite: import, export and attaching a file are exercised
 * through their commands, which take a path and are what actually touch the
 * database and the disk. What is left untested is the picker itself — OS UI, like
 * the global accelerator and the tray menu.
 */
