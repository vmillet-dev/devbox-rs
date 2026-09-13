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
 * ⚠️ Not `browser.keys`, and that is the whole point.
 *
 * The embedded WebDriver server answers `POST /session/:id/actions` with a 200 and
 * dispatches nothing. Every keyboard shortcut in this suite was therefore doing
 * nothing at all, silently — the canvas keys, `Ctrl+Z`, `Escape`, the accelerator
 * capture. A synthetic `KeyboardEvent` reaches the same handlers, because all of
 * them listen in the DOM: `CANVAS_KEYS`, `DialogStack` and `acceleratorFromEvent`.
 *
 * `code` is filled as carefully as `key`: the shortcut field reads the **physical**
 * key, so an event carrying only `key` would record the wrong accelerator and the
 * test would pass for the wrong reason.
 *
 * Out of reach — and always was, for any WebDriver: the **native** global shortcuts,
 * which the system delivers outside the window. `emitGlobalAction` covers what sits
 * downstream of those.
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
 * ⚠️ Not `selectByAttribute`. The embedded WebDriver server moves the selection
 * without the `change` the component listens to, so a `<select>` shows the new
 * value while the model keeps the old one — the language stayed `txt`, the theme
 * stayed `dark`, and the assertion read the control rather than the effect.
 *
 * Same shape as the editor's date field, which was already written this way for a
 * different reason: assign, then dispatch what the browser would have.
 */
export async function selectOption(selector: string, value: string): Promise<void> {
  await browser.execute(
    (sel: string, next: string) => {
      const field = document.querySelector(sel) as HTMLSelectElement | null;
      if (!field) {
        throw new Error(`no <select> at ${sel}`);
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
 * submission** — a native behaviour, not a handler. Neither `browser.keys` nor a
 * synthetic `KeyboardEvent` reproduces it: the browser reserves it for real user
 * input. `requestSubmit()` fires exactly the event the browser would, which is what
 * the editor's tag field listens to (`<form (submit)="submitTag($event)">`).
 */
export async function submitFormOf(selector: string): Promise<void> {
  await browser.execute((sel: string) => {
    const field = document.querySelector(sel) as HTMLInputElement | null;
    field?.form?.requestSubmit();
  }, selector);
}

/**
 * Title, body and source commit on **blur**, and the suite used to reach that with
 * `Tab`. A synthetic key event does not move focus, so the blur is asked for
 * directly rather than hoped for as a side effect.
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
 * A real restart, database and preferences kept: the profile is wiped once before
 * the runner starts and never again, so a new session meets the same
 * `app_data_dir()` the previous one wrote to. That is what makes "close it and it
 * is still there" mean anything.
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
