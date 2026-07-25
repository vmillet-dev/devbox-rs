import { Injectable, computed, inject, resource, signal } from '@angular/core';
import { SPACES_REPOSITORY } from '../data/spaces-repository.token';
import { Space } from '../models/space.model';

/**
 * Espaces disponibles et espace actif.
 *
 * TODO(feature) : `activeSpace` ne filtre encore aucune note — il ne pilote que
 * le libellé du sélecteur. Le filtrage par espace suppose que le modèle `Note`
 * porte un `spaceId`, ce qui relève du schéma de persistance côté Rust.
 * Une fois ce champ disponible, le critère se branche dans
 * `NotesStore.filteredNotes`.
 */
@Injectable({ providedIn: 'root' })
export class SpacesStore {
  private readonly repository = inject(SPACES_REPOSITORY);

  private readonly spacesResource = resource({
    loader: () => this.repository.loadAll(),
    defaultValue: [] as readonly Space[],
  });

  readonly spaces = computed<readonly Space[]>(() =>
    this.spacesResource.hasValue() ? this.spacesResource.value() : [],
  );

  private readonly _activeSpaceId = signal<string | null>(null);

  /** Le premier espace sert de défaut tant que l'utilisateur n'a rien choisi. */
  readonly activeSpace = computed<Space | null>(() => {
    const spaces = this.spaces();
    const activeId = this._activeSpaceId();
    return spaces.find((space) => space.id === activeId) ?? spaces[0] ?? null;
  });

  selectSpace(id: string): void {
    this._activeSpaceId.set(id);
  }
}
