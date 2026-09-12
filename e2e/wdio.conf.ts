import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

/**
 * Built by `npm run e2e:build`, which links the `e2e` Cargo feature and merges
 * `tauri.e2e.conf.json`. A release binary carries neither and cannot be driven.
 */
const appBinary = resolve(
  repo,
  'src-tauri/target/debug',
  process.platform === 'win32' ? 'devbox.exe' : 'devbox',
);

/**
 * `app_data_dir()` is `data_dir()/identifier`, and the e2e build carries an
 * identifier of its own — so this can be wiped without ever touching the library
 * being dogfooded at `com.devbox.app`.
 */
function e2eProfileDir(): string {
  const identifier = 'com.devbox.app.e2e';
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? '', identifier);
  }
  const xdg = process.env['XDG_DATA_HOME'];
  return xdg ? join(xdg, identifier) : join(process.env['HOME'] ?? '', '.local/share', identifier);
}

/**
 * ⚠️ `external`, and not the default `embedded`. The embedded provider keeps the
 * WebDriver server inside the application and reuses **one** process across every
 * spec file: the profile wipe below then runs against a database the living app
 * still holds open, silently does nothing, and the second spec file inherits the
 * first one's notes. `tauri-driver` spawns a process per session, which is what
 * makes "every spec file starts from a fresh install" true rather than intended.
 */
const driverProvider = 'external';

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
  // One application at a time: every spec file drives the same window and the
  // same database file, and two of them at once would fight over both.
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'tauri',
      'wdio:enforceWebDriverClassic': true,
      'tauri:options': { application: appBinary },
      'wdio:tauriServiceOptions': { appBinaryPath: appBinary, driverProvider },
    },
  ] as unknown as WebdriverIO.Capabilities[],

  // `autoInstallTauriDriver`: a fresh machine — a CI runner especially — has no
  // `tauri-driver` on PATH, and a cargo install is cheaper than a documented
  // prerequisite nobody reads.
  services: [['@wdio/tauri-service', { driverProvider, autoInstallTauriDriver: true }]],

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },

  logLevel: 'warn',
  outputDir: join(here, 'logs'),
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
  bail: 0,

  /**
   * Before the binary is spawned, not between tests: the database file is locked
   * and its WAL open for as long as the application lives. Deleting the profile
   * here is what makes every spec file start from a genuine fresh install —
   * migrations replayed, sample notes seeded.
   */
  beforeSession() {
    rmSync(e2eProfileDir(), { recursive: true, force: true });
  },
};
