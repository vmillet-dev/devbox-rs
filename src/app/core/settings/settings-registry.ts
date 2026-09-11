import { Injectable, Type, computed, signal } from '@angular/core';

/**
 * Une page du panneau de préférences, contribuée par la feature qui sait ce
 * qu'elle contient.
 *
 * `component` est rendu par `NgComponentOutlet` : le panneau affiche une page
 * dont il ignore tout, exactement comme le menu « Fichier » exécute une action
 * qu'il ne connaît pas.
 */
export interface SettingsPage {
  readonly id: string;
  readonly labelKey: string;
  /** Décide de l'ordre dans le rail ; laisse de la place entre deux pages. */
  readonly order: number;
  readonly component: Type<unknown>;
}

/**
 * Ce que le panneau de préférences propose **en plus de ses propres pages**.
 *
 * Même raison d'être qu'[`AppMenuRegistry`] : « Variables » édite les valeurs
 * de `{{champs}}`, un sujet qui appartient aux notes. L'importer depuis
 * `layout/` casserait la règle qui veut que supprimer le dossier d'une feature
 * supprime la feature — et ferait apparaître une page vide le jour où l'outil
 * de hachage sera seul à l'écran.
 */
@Injectable({ providedIn: 'root' })
export class SettingsRegistry {
  private readonly _pages = signal<readonly SettingsPage[]>([]);

  readonly pages = computed<readonly SettingsPage[]>(() =>
    [...this._pages()].sort((left, right) => left.order - right.order),
  );

  /** Réinscrire un identifiant remplace la page plutôt que de la doubler. */
  register(pages: readonly SettingsPage[]): void {
    const ids = new Set(pages.map((page) => page.id));
    this._pages.update((current) => [...current.filter((page) => !ids.has(page.id)), ...pages]);
  }

  unregister(ids: readonly string[]): void {
    const dropped = new Set(ids);
    this._pages.update((current) => current.filter((page) => !dropped.has(page.id)));
  }
}
