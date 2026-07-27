import { Injectable, Signal, computed, effect, inject, resource, signal } from '@angular/core';
import { SPACES_REPOSITORY } from '../data/spaces-repository.token';
import { ErrorNotifier } from '../errors/error-notifier.service';
import { ipcNotice } from '../errors/ipc-notice';
import { Space } from '../models/space.model';

/**
 * Espaces disponibles et espace actif.
 *
 * L'espace actif est un **filtre**, pas une simple étiquette : `NotesStore` le
 * lit pour ne montrer que les notes de l'espace, et `createNote` y range la
 * note créée.
 *
 * `null` n'est pas un état d'attente mais un choix à part entière — « tous les
 * espaces ». Il n'existe donc aucune entrée « Tous » côté données : ce serait un
 * espace fantôme dans lequel des notes pourraient être rangées par erreur. Le
 * libellé correspondant vit dans les traductions (`notes.allSpaces`).
 */
@Injectable({ providedIn: 'root' })
export class SpacesStore {
  private readonly repository = inject(SPACES_REPOSITORY);
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
   * Identifiant retenu pour le filtrage, `null` valant « tous les espaces ».
   * Un identifiant qui ne correspond à aucun espace chargé retombe sur `null`
   * plutôt que de masquer toutes les notes.
   */
  readonly activeSpaceId = computed<string | null>(() => this.activeSpace()?.id ?? null);

  readonly activeSpace = computed<Space | null>(() => {
    const activeId = this._activeSpaceId();
    return activeId === null ? null : (this.spaces().find((space) => space.id === activeId) ?? null);
  });

  constructor() {
    // Contrairement aux notes, un échec de chargement des espaces ne vide aucun
    // écran : le sélecteur affiche simplement « tous les espaces ». Sans
    // bandeau, la panne passerait donc totalement inaperçue.
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
   * Crée un espace et le rend actif. C'est la persistance qui attribue
   * l'identifiant, et le sélectionner avant de le connaître obligerait à le
   * corriger après coup.
   *
   * Un nom vide est ignoré silencieusement (l'utilisateur a validé un champ
   * vide). L'unicité, elle, n'est **pas** vérifiée ici : elle est tranchée par
   * le stockage, qui seul voit l'état réel de la base. Le refus revient sous la
   * forme d'un code (`duplicateSpaceName`), traduit ci-dessous — un message
   * rédigé en Rust s'afficherait en français dans l'interface anglaise.
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
      console.error(error);
      // Le nom saisi sert de repli d'interpolation si le back n'en fournit pas :
      // « Un espace nommé {{name}} existe déjà » doit rester lisible.
      this.notifier.notify(ipcNotice(error, { key: 'errors.spaceCreateFailed' }, { name: trimmed }));
      return null;
    }
  }
}
