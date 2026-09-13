import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IDENTIFIER = 'com.devbox.app.e2e';

/**
 * `app_data_dir()` is `data_dir()/identifier`, and the e2e build carries an identifier
 * of its own — so this can be wiped without ever touching the library being dogfooded
 * at `com.devbox.app`. It holds everything the application writes: the SQLite database,
 * `attachments/`, and `preferences.json`.
 */
function e2eDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? '', IDENTIFIER);
  }
  const xdg = process.env['XDG_DATA_HOME'];
  return xdg ? join(xdg, IDENTIFIER) : join(process.env['HOME'] ?? '', '.local/share', IDENTIFIER);
}

/**
 * ⚠️ Under the **data** directory, not the config one. `tauri-plugin-store` resolves a
 * relative path against `BaseDirectory::AppData`, and `PreferencesService` passes it no
 * base of its own.
 *
 * Worth spelling out because Windows cannot tell the two apart: `dirs::data_dir()` and
 * `dirs::config_dir()` are both `%APPDATA%\<identifier>` there, so a test looking in the
 * wrong one still passes. Linux is the only platform that splits them — `~/.local/share`
 * against `~/.config` — which is what this suite runs on precisely to catch that.
 */
export function preferencesPath(): string {
  return join(e2eDataDir(), 'preferences.json');
}

/**
 * Where `homeSpaceId()` records the seeded space, resolved once per run. Outside the
 * profile on purpose: it is the harness's own note, not the application's state.
 */
export function homeSpaceMarker(): string {
  return join(tmpdir(), 'devbox-e2e-home-space');
}

/**
 * ⚠️ Called from `npm run test:e2e`, **before** WebdriverIO starts — not from a hook.
 *
 * The embedded provider spawns the application from its own `onPrepare`, and nothing
 * orders that against the config's hooks: a wipe from inside wdio meets a living
 * process, a locked database and an open WAL. A separate process before the runner has
 * no ordering to get wrong.
 */
export function resetProfile(): void {
  rmSync(e2eDataDir(), { recursive: true, force: true });
  rmSync(homeSpaceMarker(), { force: true });
}
