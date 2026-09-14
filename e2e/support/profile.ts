import { existsSync, rmSync } from 'node:fs';
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
 * ⚠️ A second directory, and on Linux it is **not** the first one.
 *
 * `tauri-plugin-window-state` writes `.window-state.json` under `app_config_dir()`,
 * while everything else the application writes lives under `app_data_dir()`. Windows
 * cannot tell the two apart — both are `%APPDATA%\<identifier>` — which is why wiping
 * only the data directory looked complete: on Linux the geometry survived the wipe, so
 * a run inherited the window of the run before it and the first one to end on an
 * unusual size handed it to every run after. CI never saw it, its runners being new
 * each time; a developer running the suite twice did.
 */
function e2eConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? '', IDENTIFIER);
  }
  const xdg = process.env['XDG_CONFIG_HOME'];
  return xdg ? join(xdg, IDENTIFIER) : join(process.env['HOME'] ?? '', '.config', IDENTIFIER);
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
  // Both, and `new Set` because on Windows they are the same path.
  const directories = [...new Set([e2eDataDir(), e2eConfigDir()])];

  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
  rmSync(homeSpaceMarker(), { force: true });

  // ⚠️ `force` covers "it was not there", which is the ordinary case — but it also
  // swallows the one that matters: a previous run's application still holding the
  // database open, on Windows above all. The wipe then does nothing, the suite starts
  // on the corpus the last run left, and the failures blame the wrong thing — one run
  // read `["Archive", "Découverte"]` where only the seeded space should exist, and
  // the first-launch scenario, the only one that can resolve it, had already failed.
  //
  // Say so here rather than let fifteen files disagree about why.
  const survivor = directories.find((directory) => existsSync(directory));
  if (survivor) {
    throw new Error(
      `the e2e profile at ${survivor} could not be wiped — an application from a previous run is probably still holding it open`,
    );
  }
}
