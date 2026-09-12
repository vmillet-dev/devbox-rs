import { Injectable, Signal, computed, resource } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { APP_METADATA } from '@core/ipc/bindings';

/** The application's own details, generated from `Cargo.toml` at compile time. */
export const APP_INFO = APP_METADATA;

/**
 * The seam to the Tauri APIs that describe the application: core and plugin commands,
 * absent from `bindings.ts`, which a component importing them would make untestable.
 */
@Injectable({ providedIn: 'root' })
export class AppInfoService {
  private readonly versionResource = resource({ loader: () => getVersion() });

  /**
   * `null` outside the Tauri runtime (`ng serve` alone): the card then shows a dash rather
   * than lying.
   */
  readonly version: Signal<string | null> = computed(() =>
    this.versionResource.hasValue() ? this.versionResource.value() : null,
  );

  /** Opens the repository in the system browser, outside the WebView. */
  async openRepository(): Promise<void> {
    await openUrl(APP_INFO.repository);
  }
}
