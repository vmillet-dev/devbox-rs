import { Injectable, Signal, computed, signal } from '@angular/core';

/**
 * Une entrée du menu « Fichier », contribuée par la feature qui sait l'exécuter.
 *
 * `disabled` est un signal et non un booléen : « Exporter la sélection » dépend
 * de ce qui est coché à l'instant, et une valeur figée à l'enregistrement
 * n'aurait plus rien à voir avec l'écran une seconde plus tard.
 */
export interface AppMenuEntry {
  readonly id: string;
  readonly labelKey: string;
  /** Décide de l'ordre d'affichage ; laisse de la place entre deux entrées. */
  readonly order: number;
  readonly disabled?: Signal<boolean>;
  readonly run: () => void;
}

/**
 * Ce que le menu de la barre de titre propose, **contribué par les features**.
 *
 * La barre de titre est du cadre applicatif : elle ne connaît ni les notes ni
 * les outils à venir, et importer une feature depuis `layout/` casserait la
 * règle qui veut que supprimer un dossier de feature supprime la feature.
 * Chaque feature s'inscrit à son démarrage et se retire à sa destruction — un
 * outil non chargé n'a pas d'entrée, ce qui est le comportement voulu.
 */
@Injectable({ providedIn: 'root' })
export class AppMenuRegistry {
  private readonly _entries = signal<readonly AppMenuEntry[]>([]);

  readonly entries = computed<readonly AppMenuEntry[]>(() =>
    [...this._entries()].sort((left, right) => left.order - right.order),
  );

  /** Réinscrire un identifiant remplace l'entrée plutôt que de la doubler. */
  register(entries: readonly AppMenuEntry[]): void {
    const ids = new Set(entries.map((entry) => entry.id));
    this._entries.update((current) => [...current.filter((entry) => !ids.has(entry.id)), ...entries]);
  }

  unregister(ids: readonly string[]): void {
    const dropped = new Set(ids);
    this._entries.update((current) => current.filter((entry) => !dropped.has(entry.id)));
  }
}
