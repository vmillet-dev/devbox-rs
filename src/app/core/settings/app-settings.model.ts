/**
 * Les réglages de l'application, et rien d'autre : ce fichier n'importe ni
 * Angular ni Tauri, il ne sait que nommer les valeurs possibles et dire
 * lesquelles valent par défaut.
 *
 * Une préférence est stockée **par clé**, pas en un objet sérialisé :
 * `PreferencesService` écrit des chaînes dans `preferences.json`, et un réglage
 * ajouté ne doit pas rendre illisible un fichier écrit par la version d'avant.
 */

/** `system` suit `prefers-color-scheme`, que la WebView tient de l'OS. */
export const THEME_CHOICES = ['system', 'dark', 'light'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Ce que le thème vaut une fois `system` tranché — c'est ce que le CSS lit. */
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

/**
 * `compact` resserre les espacements sans toucher aux tailles de texte : une
 * densité qui rétrécirait la typographie serait un zoom, pas une densité.
 */
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export interface AppSettings {
  readonly theme: ThemeChoice;
  readonly density: Density;
  /** Démarrage avec la session : c'est le système qui tient le registre. */
  readonly startWithSystem: boolean;
  readonly minimizeToTray: boolean;
  readonly closeToTray: boolean;
  /** Accélérateur de la palette de collage rapide, au format Tauri. */
  readonly paletteShortcut: string;
  /** Remonte les notes épinglées en tête de la palette. */
  readonly showPinnedFirst: boolean;
  /** Accuse chaque copie dans le presse-papier sous la barre de titre. */
  readonly copyConfirmation: boolean;
}

/**
 * ⚠️ `closeToTray` vaut `true` : c'est ce que DevBox a toujours fait, et
 * basculer ce défaut ferait quitter l'application à des utilisateurs qui
 * n'attendaient qu'un rangement. Le natif porte le même défaut, pour la fenêtre
 * fermée avant que le front ait démarré (`desktop::WindowBehavior`).
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  density: 'comfortable',
  startWithSystem: false,
  minimizeToTray: false,
  closeToTray: true,
  paletteShortcut: 'Ctrl+Alt+P',
  showPinnedFirst: true,
  copyConfirmation: true,
};

/** Une clé par réglage, toutes préfixées : `PreferencesService` ne reprend du `localStorage` hérité que ce qui commence par `devbox.`. */
export const SETTINGS_KEYS: Readonly<Record<keyof AppSettings, string>> = {
  theme: 'devbox.theme',
  density: 'devbox.density',
  startWithSystem: 'devbox.startWithSystem',
  minimizeToTray: 'devbox.minimizeToTray',
  closeToTray: 'devbox.closeToTray',
  paletteShortcut: 'devbox.paletteShortcut',
  showPinnedFirst: 'devbox.showPinnedFirst',
  copyConfirmation: 'devbox.copyConfirmation',
};
