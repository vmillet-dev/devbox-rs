import { APP_LOCALES } from '@core/services/i18n/locale.model';
import { DEFAULT_SHORTCUTS } from '@core/services/shortcuts/shortcut.model';

/**
 * ⚠️ A preference is stored per key rather than as one serialised object, so a setting
 * added later cannot make a file written by the previous version unreadable.
 */

export const LOCALE_CHOICES = ['system', ...APP_LOCALES] as const;
export type LocaleChoice = (typeof LOCALE_CHOICES)[number];

export const THEME_CHOICES = ['system', 'dark', 'light'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

/** Spacing only: a density that shrank the typography would be a zoom. */
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export interface AppSettings {
  readonly locale: LocaleChoice;
  readonly theme: ThemeChoice;
  readonly density: Density;
  readonly startWithSystem: boolean;
  readonly minimizeToTray: boolean;
  readonly closeToTray: boolean;
  readonly paletteShortcut: string;
  readonly showPinnedFirst: boolean;
  /** ⚠️ Read by Rust at launch, before the front end exists: `backup::wanted`. */
  readonly automaticBackups: boolean;
  readonly copyConfirmation: boolean;
  readonly updateNotifications: boolean;
  /**
   * The version the user said "later" to, or `''`. A version and not a boolean:
   * remembering "no" would silence the release after it too.
   */
  readonly skippedUpdate: string;
}

/** ⚠️ `closeToTray` is `true`, and the native side carries the same default. */
export const DEFAULT_SETTINGS: AppSettings = {
  locale: 'system',
  theme: 'system',
  density: 'comfortable',
  startWithSystem: false,
  minimizeToTray: false,
  closeToTray: true,
  paletteShortcut: DEFAULT_SHORTCUTS.palette,
  showPinnedFirst: true,
  automaticBackups: true,
  copyConfirmation: true,
  updateNotifications: true,
  skippedUpdate: '',
};

/** Derived rather than hand-written: the key is the field name, prefixed. */
export const SETTINGS_KEYS = Object.fromEntries(
  Object.keys(DEFAULT_SETTINGS).map((field) => [field, `devbox.${field}`]),
) as Readonly<Record<keyof AppSettings, string>>;
