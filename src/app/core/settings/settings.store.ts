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

/** Ce que la WebView tient de l'OS ; absente hors navigateur (jsdom en a une inerte). */
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isOneOf<T extends string>(values: readonly T[], candidate: string | null): candidate is T {
  return (values as readonly string[]).includes(candidate ?? '');
}

/**
 * Les réglages de l'application : source de vérité pour l'interface, adossée à
 * `PreferencesService` — donc à un vrai fichier, qui survit à un vidage de la
 * WebView.
 *
 * **Les écritures s'appliquent tout de suite.** Pas d'« OK / Annuler » : c'est
 * déjà l'idiome de l'application (l'éditeur enregistre au blur, le sélecteur de
 * langue bascule au clic), et un thème qu'on ne voit qu'après validation ne se
 * choisit pas, il se devine.
 *
 * Ce store ne parle à personne d'autre : ce sont les services natifs qui
 * *lisent* ces signaux et poussent vers le Rust ([`GlobalShortcutsService`],
 * [`WindowBehaviorService`], [`AutostartService`]). L'inverse mettrait l'IPC
 * dans un store de préférences, qui doit rester lisible hors Tauri.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly preferences = inject(PreferencesService);

  private readonly _theme = signal<ThemeChoice>(DEFAULT_SETTINGS.theme);
  private readonly _density = signal<Density>(DEFAULT_SETTINGS.density);
  private readonly _startWithSystem = signal(DEFAULT_SETTINGS.startWithSystem);
  private readonly _minimizeToTray = signal(DEFAULT_SETTINGS.minimizeToTray);
  private readonly _closeToTray = signal(DEFAULT_SETTINGS.closeToTray);
  private readonly _paletteShortcut = signal(DEFAULT_SETTINGS.paletteShortcut);
  private readonly _showPinnedFirst = signal(DEFAULT_SETTINGS.showPinnedFirst);
  private readonly _copyConfirmation = signal(DEFAULT_SETTINGS.copyConfirmation);

  readonly theme = this._theme.asReadonly();
  readonly density = this._density.asReadonly();
  readonly startWithSystem = this._startWithSystem.asReadonly();
  readonly minimizeToTray = this._minimizeToTray.asReadonly();
  readonly closeToTray = this._closeToTray.asReadonly();
  readonly paletteShortcut = this._paletteShortcut.asReadonly();
  readonly showPinnedFirst = this._showPinnedFirst.asReadonly();
  readonly copyConfirmation = this._copyConfirmation.asReadonly();

  /** Ce que l'OS demande, suivi en direct : un thème « système » doit basculer sans relancer l'application. */
  private readonly systemPrefersDark = signal(false);

  /** Le thème une fois `system` tranché — c'est cette valeur que le CSS lit. */
  readonly resolvedTheme: Signal<ResolvedTheme> = computed(() => {
    const choice = this._theme();
    if (choice !== 'system') return choice;

    return this.systemPrefersDark() ? 'dark' : 'light';
  });

  constructor() {
    this.watchSystemTheme();

    // `<html>` porte le thème et la densité : les variables CSS vivent sur
    // `:root`, et une classe posée plus bas ne les atteindrait pas.
    effect(() => {
      const root = document.documentElement;
      root.dataset['theme'] = this.resolvedTheme();
      root.dataset['density'] = this._density();
    });
  }

  /**
   * Relit les réglages enregistrés. Appelée depuis `provideAppInitializer`,
   * **après** `PreferencesService.hydrate()` : lire avant rendrait les valeurs
   * par défaut, et l'interface apparaîtrait dans un thème puis dans l'autre.
   */
  restore(): void {
    const theme = this.preferences.read(SETTINGS_KEYS.theme);
    if (isOneOf(THEME_CHOICES, theme)) this._theme.set(theme);

    const density = this.preferences.read(SETTINGS_KEYS.density);
    if (isOneOf(DENSITIES, density)) this._density.set(density);

    this._startWithSystem.set(this.readFlag('startWithSystem'));
    this._minimizeToTray.set(this.readFlag('minimizeToTray'));
    this._closeToTray.set(this.readFlag('closeToTray'));
    this._showPinnedFirst.set(this.readFlag('showPinnedFirst'));
    this._copyConfirmation.set(this.readFlag('copyConfirmation'));

    // Une combinaison vide désarmerait la palette sans rien dire : mieux vaut
    // celle d'origine, que le panneau affiche et que l'on peut rechanger.
    const shortcut = this.preferences.read(SETTINGS_KEYS.paletteShortcut)?.trim();
    if (shortcut) this._paletteShortcut.set(shortcut);
  }

  setTheme(theme: ThemeChoice): void {
    this._theme.set(theme);
    this.preferences.write(SETTINGS_KEYS.theme, theme);
  }

  setDensity(density: Density): void {
    this._density.set(density);
    this.preferences.write(SETTINGS_KEYS.density, density);
  }

  setStartWithSystem(enabled: boolean): void {
    this._startWithSystem.set(enabled);
    this.writeFlag('startWithSystem', enabled);
  }

  setMinimizeToTray(enabled: boolean): void {
    this._minimizeToTray.set(enabled);
    this.writeFlag('minimizeToTray', enabled);
  }

  setCloseToTray(enabled: boolean): void {
    this._closeToTray.set(enabled);
    this.writeFlag('closeToTray', enabled);
  }

  /** Une combinaison vide est refusée : elle laisserait la palette sans appel. */
  setPaletteShortcut(accelerator: string): void {
    const trimmed = accelerator.trim();
    if (!trimmed) return;

    this._paletteShortcut.set(trimmed);
    this.preferences.write(SETTINGS_KEYS.paletteShortcut, trimmed);
  }

  setShowPinnedFirst(enabled: boolean): void {
    this._showPinnedFirst.set(enabled);
    this.writeFlag('showPinnedFirst', enabled);
  }

  setCopyConfirmation(enabled: boolean): void {
    this._copyConfirmation.set(enabled);
    this.writeFlag('copyConfirmation', enabled);
  }

  private readFlag(key: keyof AppSettings): boolean {
    const stored = this.preferences.read(SETTINGS_KEYS[key]);

    // Rien d'enregistré n'est pas « faux » : c'est le défaut du réglage.
    return stored === null ? Boolean(DEFAULT_SETTINGS[key]) : stored === 'true';
  }

  private writeFlag(key: keyof AppSettings, value: boolean): void {
    this.preferences.write(SETTINGS_KEYS[key], String(value));
  }

  private watchSystemTheme(): void {
    // `matchMedia` manque à certains environnements de test ; sans lui le thème
    // « système » retombe sur le clair, ce que le défaut du CSS assume.
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return;

    this.systemPrefersDark.set(media.matches);
    media.addEventListener('change', (event) => this.systemPrefersDark.set(event.matches));
  }
}
