import { Injectable, Signal, computed, effect, inject, resource, signal } from '@angular/core';
import { SpacesRepository } from '../data/spaces.repository';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { Space } from '../model/space.model';

/**
 * Espaces disponibles et espace actif. L'espace actif est un **filtre** :
 * `NotesStore` le lit pour restreindre la vue, et `createNote` y range la note.
 *
 * `null` n'est pas un état d'attente mais un choix — « tous les espaces ». Aucune
 * entrée « Tous » n'existe côté données : ce serait un espace fantôme dans lequel
 * des notes pourraient être rangées par erreur.
 */
@Injectable({ providedIn: 'root' })
export class SpacesStore {
  private readonly repository = inject(SpacesRepository);
  private readonly notifier = inject(ErrorNotifier);

  private readonly spacesResource = resource({
    loader: () => this.repository.loadAll(),
    defaultValue: [] as readonly Space[],
  });

  readonly spaces = computed<readonly Space[]>(() =>
    this.spacesResource.hasValue() ? this.spacesResource.value() : [],
  );

  readonly isLoading = this.spacesResource.isLoading;
  readonly loadError: Signal<Error | undefined> = this.spacesResource.error;

  private readonly _activeSpaceId = signal<string | null>(null);

  /**
   * `null` vaut « tous les espaces ». Un identifiant inconnu y retombe plutôt
   * que de masquer toutes les notes.
   */
  readonly activeSpaceId = computed<string | null>(() => this.activeSpace()?.id ?? null);

  readonly activeSpace = computed<Space | null>(() => {
    const activeId = this._activeSpaceId();
    return activeId === null ? null : (this.spaces().find((space) => space.id === activeId) ?? null);
  });

  constructor() {
    // Contrairement aux notes, un échec ici ne vide aucun écran : le sélecteur
    // affiche « tous les espaces ». Sans bandeau, la panne passerait inaperçue.
    effect(() => {
      const error = this.loadError();
      if (error) {
        this.notifier.notify({ ref: { key: 'errors.spacesLoadFailed' }, detail: error.message });
      }
    });
  }

  reload(): void {
    this.spacesResource.reload();
  }

  /** `null` sélectionne « tous les espaces ». */
  selectSpace(id: string | null): void {
    this._activeSpaceId.set(id);
  }

  /**
   * Crée un espace et le rend actif ; l'identifiant vient de la persistance.
   *
   * Un nom vide est ignoré silencieusement. L'unicité n'est **pas** vérifiée
   * ici : seul le stockage voit l'état réel de la base, et son refus revient
   * sous forme de code traduit.
   */
  async createSpace(name: string): Promise<Space | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;

    try {
      const created = await this.repository.create({ name: trimmed });
      this.spacesResource.set([...this.spaces(), created]);
      this.selectSpace(created.id);
      return created;
    } catch (error) {
      // Le nom saisi sert de repli d'interpolation si le back n'en fournit pas :
      // « Un espace nommé {{name}} existe déjà » doit rester lisible.
      this.notifier.reportFailure('errors.spaceCreateFailed', error, { name: trimmed });
      return null;
    }
  }

  /**
   * L'écriture n'est pas optimiste : la liste n'adopte que ce que la
   * persistance a renvoyé. L'unicité y exclut l'espace renommé — corriger la
   * casse d'un nom est légitime.
   */
  async renameSpace(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    const current = this.spaces().find((space) => space.id === id);
    if (!trimmed || !current || current.name === trimmed) return false;

    try {
      const renamed = await this.repository.rename(id, { name: trimmed });
      this.spacesResource.set(this.spaces().map((space) => (space.id === id ? renamed : space)));
      return true;
    } catch (error) {
      this.notifier.reportFailure('errors.spaceRenameFailed', error, { name: trimmed });
      return false;
    }
  }

  /**
   * Supprime un espace en transférant ses notes vers `targetSpaceId`, qui
   * devient actif : les notes viennent d'y atterrir, et retomber sur « tous les
   * espaces » ferait perdre de vue où elles sont passées.
   *
   * Ne recharge **pas** les notes — ce store ne connaît pas `NotesStore`,
   * l'inverse serait un cycle d'injection. D'où le booléen renvoyé.
   */
  async deleteSpace(id: string, targetSpaceId: string): Promise<boolean> {
    // Un espace ne peut pas être son propre refuge : la cascade emporterait les
    // notes juste après le transfert. Le back refuse aussi ; ce garde évite
    // seulement un aller-retour.
    if (id === targetSpaceId || !this.spaces().some((space) => space.id === targetSpaceId)) {
      return false;
    }

    try {
      await this.repository.delete(id, targetSpaceId);
      this.spacesResource.set(this.spaces().filter((space) => space.id !== id));
      this.selectSpace(targetSpaceId);
      return true;
    } catch (error) {
      this.notifier.reportFailure('errors.spaceDeleteFailed', error);
      return false;
    }
  }
}
