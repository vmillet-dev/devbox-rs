import { $, $$, browser } from '@wdio/globals';

import type { GlobalAction } from '@core/ipc/bindings';

/** `[data-testid="…"]`, in one place, so a spec never spells the attribute. */
export function testid(name: string): string {
  return `[data-testid="${name}"]`;
}

/** Consecutive quiet polls before the canvas counts as settled, `SETTLE_INTERVAL` apart. */
const SETTLE_POLLS = 3;
const SETTLE_INTERVAL = 200;

/**
 * The canvas is behind a lazy route, a `resource` and a debounce; every scenario
 * starts by waiting for it rather than for the window, which exists long before
 * anything is queryable.
 */
export async function waitForCanvas(): Promise<void> {
  await $(testid('canvas')).waitForExist({ timeout: 30_000 });

  // ⚠️ Not "`aria-busy` went false" once. The canvas clears that flag between two
  // reloads, and a burst of writes produces several — first launch seeds four sample
  // notes, so it goes idle four times. Commands run off the IPC thread, so the window
  // repaints between them instead of once at the end; a count read in that gap sees a
  // half-filled canvas, and a card list read across it sees elements being replaced.
  //
  // Settled therefore means idle *and* unchanged: the card count has to hold still.
  let previous = -1;
  let quiet = 0;

  await browser.waitUntil(
    async () => {
      if ((await $(testid('canvas')).getAttribute('aria-busy')) === 'true') {
        quiet = 0;
        previous = -1;
        return false;
      }

      const count = await $$(testid('note-card')).length;
      quiet = count === previous ? quiet + 1 : 0;
      previous = count;

      return quiet >= SETTLE_POLLS;
    },
    {
      timeout: 30_000,
      interval: SETTLE_INTERVAL,
      timeoutMsg: 'the canvas never settled',
    },
  );
}

export type Modifier = 'Control' | 'Alt' | 'Shift' | 'Meta';

/** `KeyboardEvent.code`: a letter is its physical key, a digit its own. */
function codeFor(key: string): string {
  if (/^[a-z]$/i.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(key)) {
    return `Digit${key}`;
  }
  return key;
}

/**
 * ⚠️ Not `browser.keys`: the embedded WebDriver server answers
 * `POST /session/:id/actions` with a 200 and dispatches nothing, so every shortcut in
 * this suite was silently doing nothing. A synthetic `KeyboardEvent` reaches the same
 * handlers, which all listen in the DOM (`CANVAS_KEYS`, `DialogStack`,
 * `acceleratorFromEvent`).
 *
 * `code` is filled as carefully as `key`: the shortcut field reads the **physical**
 * key, so an event carrying only `key` would record the wrong accelerator and the test
 * would pass for the wrong reason.
 *
 * Out of reach for any WebDriver: the **native** global shortcuts, which the system
 * delivers outside the window. `emitGlobalAction` covers what sits downstream of those.
 */
export async function press(key: string, modifiers: Modifier[] = []): Promise<void> {
  await browser.execute(
    (k: string, code: string, mods: string[]) => {
      const target: Element = document.activeElement ?? document.body;
      const init: KeyboardEventInit = {
        key: k,
        code,
        bubbles: true,
        cancelable: true,
        ctrlKey: mods.includes('Control'),
        altKey: mods.includes('Alt'),
        shiftKey: mods.includes('Shift'),
        metaKey: mods.includes('Meta'),
      };
      target.dispatchEvent(new KeyboardEvent('keydown', init));
      target.dispatchEvent(new KeyboardEvent('keyup', init));
    },
    key,
    codeFor(key),
    modifiers,
  );
}

/**
 * Assign the value, then dispatch the `change` the browser would have.
 *
 * ⚠️ Covers `<select>` and `<input type="date">` alike, and neither can be driven the
 * obvious way. `selectByAttribute` moves the selection without the `change` the
 * components listen to, so the model kept the old value while the control showed the
 * new one; and a date input accepts keystrokes in the **display** format, which follows
 * the WebView's locale — a spec typing `15/06/2030` would pass at home and fail on an
 * English runner.
 *
 * What this skips is the browser's own parsing; every handler downstream still runs.
 */
export async function setNativeValue(selector: string, value: string): Promise<void> {
  await $(selector).waitForExist({ timeout: 10_000 });
  await browser.execute(
    (sel: string, next: string) => {
      const field = document.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null;
      if (!field) {
        throw new Error(`no field at ${sel}`);
      }
      field.value = next;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    },
    selector,
    value,
  );
}

/**
 * Enter inside a text input submits its form through the browser's **implicit
 * submission** — a native behaviour, not a handler, and one the browser reserves for
 * real user input. `requestSubmit()` fires exactly the event the form listens to.
 */
export async function submitFormOf(selector: string): Promise<void> {
  await browser.execute((sel: string) => {
    const field = document.querySelector(sel) as HTMLInputElement | null;
    field?.form?.requestSubmit();
  }, selector);
}

/**
 * Title, body and source commit on **blur**. A synthetic key event does not move
 * focus, so the blur is asked for directly rather than hoped for as a side effect.
 */
export async function blur(): Promise<void> {
  await browser.execute(() => {
    (document.activeElement as HTMLElement | null)?.blur();
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
 * ⚠️ **Not** a restart of the application, and it cannot be one.
 *
 * Under the `embedded` driver provider the WebDriver server lives *inside* the
 * application, so `reloadSession` tears the session down and opens a new one against
 * the same living process — which has to stay up, since it *is* the server. The Rust
 * side, its SQLite connection and the store plugin's in-memory map all survive.
 *
 * What it does buy is a front end built from nothing: the new session loads the page
 * fresh, so Angular reboots and every store is reconstructed from what the commands
 * answer rather than from a signal it was still holding.
 *
 * ⚠️ Never use it to prove that something reached the **disk** — it cannot.
 * `15-preferences-on-disk.e2e.ts` reads the file from Node for that.
 */
export async function reopenSession(): Promise<void> {
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
 * ⚠️ On Windows the clipboard is a single global lock, and a clipboard manager (or the
 * history pane) can hold it indefinitely; on a headless Linux runner there may be no
 * selection owner at all. Either way that is a property of the runner, not of DevBox,
 * so a caller treats `null` as "not observable here" and skips rather than fails — and
 * asserts on `DisplayNote.copyText`, which is the part DevBox owns.
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
 * ⚠️ There is no way to stand in front of the OS file picker, and the scenarios are
 * written around that rather than against it.
 *
 * `window.__TAURI_INTERNALS__.invoke` — the single funnel every `invoke` goes through,
 * the application's own included — is defined `writable: false, configurable: false`.
 * Neither an assignment nor `Object.defineProperty` can wrap it, which is deliberate
 * hardening on Tauri's side; `browser.tauri.mock()` cannot reach it either. So a picker
 * opened by a click blocks the whole application until a human clicks it.
 *
 * Consequence for the suite: import, export and attaching a file are exercised through
 * their commands, which take a path and are what actually touch the database and the
 * disk. The controls that *open* a picker are asserted on, never clicked — like the
 * tray menu and the global accelerator, they are OS UI.
 */
