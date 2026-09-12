import { APP_LOCALES } from '@core/services/i18n/locale.model';
import { DEFAULT_SHORTCUTS } from '@core/services/shortcuts/shortcut.model';

/**
 * The application's settings, and nothing else: this file imports neither Angular nor
 * Tauri. A preference is stored **per key** rather than as one serialised object, so a
 * setting added later cannot make a file written by the previous version unreadable.
 */

/** `system` follows the OS display language, falling back to English. */
export const LOCALE_CHOICES = ['system', ...APP_LOCALES] as const;
export type LocaleChoice = (typeof LOCALE_CHOICES)[number];

/** `system` follows `prefers-color-scheme`, which the WebView gets from the OS. */
export const THEME_CHOICES = ['system', 'dark', 'light'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** What the theme is worth once `system` is resolved — what the CSS reads. */
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

/**
 * `compact` tightens the spacing without touching type sizes: a density that shrank the
 * typography would be a zoom, not a density.
 */
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export interface AppSettings {
  readonly locale: LocaleChoice;
  readonly theme: ThemeChoice;
  readonly density: Density;
  /** Start with the session: the system holds the register. */
  readonly startWithSystem: boolean;
  readonly minimizeToTray: boolean;
  readonly closeToTray: boolean;
  /** Quick-paste palette accelerator, in Tauri's format. */
  readonly paletteShortcut: string;
  /** Hoists pinned notes to the top of the palette. */
  readonly showPinnedFirst: boolean;
  /** Acknowledges every clipboard copy under the titlebar. */
  readonly copyConfirmation: boolean;
}

/**
 * ⚠️ `closeToTray` is `true`: that is what DevBox has always done, and flipping it would
 * quit the application for users who only expected it filed away. The native side carries
 * the same default.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  locale: 'system',
  theme: 'system',
  density: 'comfortable',
  startWithSystem: false,
  minimizeToTray: false,
  closeToTray: true,
  // Read rather than retyped: the accelerator already lives in two places.
  paletteShortcut: DEFAULT_SHORTCUTS.palette,
  showPinnedFirst: true,
  copyConfirmation: true,
};

/** Derived rather than hand-written: the key **is** the field name, prefixed. */
export const SETTINGS_KEYS = Object.fromEntries(
  Object.keys(DEFAULT_SETTINGS).map((field) => [field, `devbox.${field}`]),
) as Readonly<Record<keyof AppSettings, string>>;
