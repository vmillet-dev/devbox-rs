import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { PreferencesService } from '@core/preferences/preferences.service';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  DENSITIES,
  Density,
  ResolvedTheme,
  SETTINGS_KEYS,
  THEME_CHOICES,
  ThemeChoice,
} from './app-settings.model';

/** What the WebView gets from the OS; absent outside a browser (jsdom has an inert one). */
const DARK_QUERY = '(prefers-color-scheme: dark)';

interface SettingCodec<T> {
  /** `null` rejects the stored value, and the setting keeps its default. */
  parse(stored: string): T | null;
  format(value: T): string;
}

const asBoolean: SettingCodec<boolean> = {
  parse: (stored) => (stored === 'true' ? true : stored === 'false' ? false : null),
  format: String,
};

/** A blank accelerator would leave the palette unreachable without saying so. */
const asAccelerator: SettingCodec<string> = {
  parse: (stored) => stored.trim() || null,
  format: (value) => value,
};

function asOneOf<T extends string>(values: readonly T[]): SettingCodec<T> {
  return {
    parse: (stored) => ((values as readonly string[]).includes(stored) ? (stored as T) : null),
    format: (value) => value,
  };
}

export type SettingSignal<T> = Signal<T> & { write(value: T): void };

/**
 * **Writes apply immediately.** No "OK / Cancel": it is already the idiom here, and a
 * theme you only see after confirming is guessed at rather than chosen.
 *
 * This store talks to nobody: the native services *read* these signals and push to Rust.
 * The other way round would put IPC in a preferences store, which has to stay readable
 * outside Tauri.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly preferences = inject(PreferencesService);

  /**
   * ⚠️ Declared before the settings below: class fields initialise in order,
   * and `setting()` pushes into this on the way.
   */
  private readonly restorers: (() => void)[] = [];

  readonly theme = this.setting('theme', asOneOf(THEME_CHOICES));
  readonly density = this.setting('density', asOneOf(DENSITIES));
  readonly startWithSystem = this.setting('startWithSystem', asBoolean);
  readonly minimizeToTray = this.setting('minimizeToTray', asBoolean);
  readonly closeToTray = this.setting('closeToTray', asBoolean);
  readonly paletteShortcut = this.setting('paletteShortcut', asAccelerator);
  readonly showPinnedFirst = this.setting('showPinnedFirst', asBoolean);
  readonly copyConfirmation = this.setting('copyConfirmation', asBoolean);

  /** What the OS asks for, followed live: a "system" theme must switch without a restart. */
  private readonly systemPrefersDark = signal(false);

  readonly resolvedTheme: Signal<ResolvedTheme> = computed(() => {
    const choice = this.theme();

    return choice === 'system' ? (this.systemPrefersDark() ? 'dark' : 'light') : choice;
  });

  constructor() {
    this.watchSystemTheme();

    // `<html>` carries the theme and the density: the CSS variables live on `:root`,
    // and a class set any lower would not reach them.
    effect(() => {
      const root = document.documentElement;
      root.dataset['theme'] = this.resolvedTheme();
      root.dataset['density'] = this.density();
    });
  }

  /**
   * Called from `provideAppInitializer`, **after** `PreferencesService.hydrate()`:
   * reading before would yield the defaults, and the interface would appear in one theme
   * then the other.
   */
  restore(): void {
    for (const restore of this.restorers) {
      restore();
    }
  }

  setTheme(theme: ThemeChoice): void {
    this.theme.write(theme);
  }

  setDensity(density: Density): void {
    this.density.write(density);
  }

  setStartWithSystem(enabled: boolean): void {
    this.startWithSystem.write(enabled);
  }

  setMinimizeToTray(enabled: boolean): void {
    this.minimizeToTray.write(enabled);
  }

  setCloseToTray(enabled: boolean): void {
    this.closeToTray.write(enabled);
  }

  /** A blank combination is refused: it would leave the palette with no call. */
  setPaletteShortcut(accelerator: string): void {
    this.paletteShortcut.write(accelerator);
  }

  setShowPinnedFirst(enabled: boolean): void {
    this.showPinnedFirst.write(enabled);
  }

  setCopyConfirmation(enabled: boolean): void {
    this.copyConfirmation.write(enabled);
  }

  /**
   * One setting: its signal, its restore step and its write-through, from a single
   * declaration.
   */
  private setting<K extends keyof AppSettings>(
    key: K,
    codec: SettingCodec<AppSettings[K]>,
  ): SettingSignal<AppSettings[K]> {
    const current = signal(DEFAULT_SETTINGS[key]);

    this.restorers.push(() => {
      const stored = this.preferences.read(SETTINGS_KEYS[key]);
      // Nothing stored is not "false": it is the setting's default.
      const parsed = stored === null ? null : codec.parse(stored);
      if (parsed !== null) {
        current.set(parsed);
      }
    });

    const write = (value: AppSettings[K]): void => {
      // Through the codec both ways, so a value the restore path would reject
      // is refused on the way in too.
      const accepted = codec.parse(codec.format(value));
      if (accepted === null) return;

      current.set(accepted);
      this.preferences.write(SETTINGS_KEYS[key], codec.format(accepted));
    };

    return Object.assign(current.asReadonly(), { write });
  }

  private watchSystemTheme(): void {
    // `matchMedia` is missing from some test environments; without it the
    // "system" theme falls back to light, which the CSS default assumes.
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return;

    this.systemPrefersDark.set(media.matches);
    media.addEventListener('change', (event) => {
      this.systemPrefersDark.set(event.matches);
    });
  }
}
