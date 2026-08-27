import { InjectionToken, Injectable, inject } from '@angular/core';
import { exit } from '@tauri-apps/plugin-process';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Ce que le front demande à la fenêtre native. Un jeton, comme pour le
 * presse-papier : sous jsdom il n'y a pas de pont, et un spec qui appellerait
 * `exit()` pour de bon arrêterait le lanceur de tests.
 */
export interface AppWindowAdapter {
  hide(): Promise<void>;
  exit(code: number): Promise<void>;
}

export const APP_WINDOW_ADAPTER = new InjectionToken<AppWindowAdapter>('APP_WINDOW_ADAPTER', {
  providedIn: 'root',
  factory: () => ({
    hide: () => getCurrentWindow().hide(),
    exit: (code: number) => exit(code),
  }),
});

/**
 * Masquer la fenêtre et quitter l'application.
 *
 * Les deux sont distincts et le restent : la croix de la fenêtre **masque**
 * (`lib.rs` intercepte `CloseRequested` tant qu'il y a une barre système), et
 * `quit` est le seul chemin qui termine réellement le processus.
 */
@Injectable({ providedIn: 'root' })
export class AppWindowService {
  private readonly adapter = inject(APP_WINDOW_ADAPTER);

  /** Après une copie depuis la palette : l'utilisateur repart coller ailleurs. */
  async hide(): Promise<void> {
    try {
      await this.adapter.hide();
    } catch {
      // Hors Tauri, ou fenêtre déjà masquée : rien à rattraper.
    }
  }

  async quit(): Promise<void> {
    try {
      await this.adapter.exit(0);
    } catch {
      // Idem : un échec ici ne laisse rien d'incohérent derrière lui.
    }
  }
}
