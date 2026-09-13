import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IDENTIFIER = 'com.devbox.app.e2e';

/**
 * `app_data_dir()` is `data_dir()/identifier`, and the e2e build carries an
 * identifier of its own — so this can be wiped without ever touching the library
 * being dogfooded at `com.devbox.app`.
 */
function e2eDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? '', IDENTIFIER);
  }
  const xdg = process.env['XDG_DATA_HOME'];
  return xdg ? join(xdg, IDENTIFIER) : join(process.env['HOME'] ?? '', '.local/share', IDENTIFIER);
}

/**
 * ⚠️ Not the same directory as the data one, and only on Linux. `dirs::config_dir()`
 * is `%APPDATA%` on Windows — the same folder the database sits in — but `~/.config`
 * on Linux, where `~/.local/share` holds the data. Wiping one and not the other left
 * the runner reading the previous run's preferences on Linux only.
 */
function e2eConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? '', IDENTIFIER);
  }
  const xdg = process.env['XDG_CONFIG_HOME'];
  return xdg ? join(xdg, IDENTIFIER) : join(process.env['HOME'] ?? '', '.config', IDENTIFIER);
}

/** Written by `tauri-plugin-store`, which resolves a relative path against `app_config_dir()`. */
export function preferencesPath(): string {
  return join(e2eConfigDir(), 'preferences.json');
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
 * process, a locked database and an open WAL. A separate process before the runner
 * has no ordering to get wrong.
 */
export function resetProfile(): void {
  rmSync(e2eDataDir(), { recursive: true, force: true });
  rmSync(e2eConfigDir(), { recursive: true, force: true });
  rmSync(homeSpaceMarker(), { force: true });
}
