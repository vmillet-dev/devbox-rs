import { rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `app_data_dir()` is `data_dir()/identifier`, and the e2e build carries an
 * identifier of its own — so this can be wiped without ever touching the library
 * being dogfooded at `com.devbox.app`.
 */
export function e2eProfileDir(): string {
  const identifier = 'com.devbox.app.e2e';
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? '', identifier);
  }
  const xdg = process.env['XDG_DATA_HOME'];
  return xdg ? join(xdg, identifier) : join(process.env['HOME'] ?? '', '.local/share', identifier);
}

/**
 * ⚠️ Called from `npm run test:e2e`, **before** WebdriverIO starts — not from a hook.
 *
 * The embedded provider spawns the application once for the whole run, from its own
 * `onPrepare`, and nothing orders that against the config's hooks. Every attempt to
 * wipe from inside wdio either landed on a living app — database locked, WAL open,
 * the server going down with its data — or, once guarded against running twice, on
 * nothing at all. A separate process before the runner has no ordering to get wrong.
 *
 * What it buys: the first spec file meets a genuine fresh install, migrations
 * replayed and sample notes seeded, which is the one scenario no unit suite reaches.
 */
export function resetProfile(): void {
  rmSync(e2eProfileDir(), { recursive: true, force: true });
}
