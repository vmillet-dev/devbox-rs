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
 * `embedded`: the WebDriver server runs **inside the application**, through
 * `tauri-plugin-wdio-webdriver`, and WebdriverIO connects straight to it. No
 * `tauri-driver`, no msedgedriver, no Chrome DevTools protocol — and therefore
 * none of what that chain needs from its host.
 *
 * ⚠️ This used to be `external`, and that is what made the suite unrunnable on CI.
 * The external chain drives the WebView through msedgedriver, which launches the
 * binary expecting Chromium's handshake and gives up on `DevToolsActivePort file
 * doesn't exist` — an error naming neither the port nor the cause. It passed on a
 * developer machine and failed on every runner, identically, for hours.
 *
 * The reason `external` was chosen was real, and it still costs something: this
 * provider spawns the application **once** for the whole run, so every spec file
 * drives the same process and the same database. The profile is therefore wiped
 * before the runner starts (`npm run test:e2e`, see `support/profile.ts`) rather
 * than between sessions, and `before()` below reloads the page so each file at
 * least meets a fresh interface.
 *
 * `external` is also absent from the documented values (`embedded` | `official` |
 * `crabnebula`); it was accepted and quietly routed to the tauri-driver path.
 */
const driverProvider = 'embedded';

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

  // No `autoInstallTauriDriver` any more: the embedded provider needs no external
  // driver at all, so a runner installs nothing and waits for nothing. `embeddedPort`
  // is the base — each worker gets that port plus its own index.
  services: [['@wdio/tauri-service', { driverProvider, appBinaryPath: appBinary, embeddedPort: 4445 }]],

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },

  /**
   * `trace`, not `warn`: at `warn` the files under `outputDir` hold almost nothing,
   * and a session that fails to open leaves no trace of what the driver actually
   * tried. The volume only matters when something breaks, which is the only time
   * anyone opens them.
   */
  logLevel: 'trace',
  outputDir: join(here, 'logs'),
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  /**
   * A session that will not open fails **every** spec file the same way, so the
   * twelfth failure teaches nothing the first did not — it only costs ten minutes
   * and a cancelled run that uploads no artifact. Stopping on the first keeps the
   * report readable and the logs collected.
   */
  bail: 1,

  /**
   * One application serves the whole run, so a spec file inherits whatever the
   * previous one left on screen — an overlay still open, a filter still set, a
   * selection still ticked. The per-file process restart used to clear that for
   * free; reloading the page buys it back, giving each file a fresh front end
   * over the shared database. Angular reboots, and every store with it.
   *
   * Imported inside the hook on purpose: the launcher loads this file too, and it
   * has no `browser` to speak of.
   */
  async before() {
    const { browser } = await import('@wdio/globals');
    await browser.refresh();
  },
};
