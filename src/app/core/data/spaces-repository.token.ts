import { InjectionToken } from '@angular/core';
import { Space, SpaceDraft } from '../models/space.model';

/**
 * Point d'accès aux espaces, sur le même modèle que `NOTES_REPOSITORY` : aucun
 * composant ne doit importer un jeu de données directement, sans quoi le
 * passage au backend Rust obligerait à retoucher les composants.
 *
 * Mêmes conventions que pour les notes : `create` **renvoie l'espace tel que
 * persisté** (c'est la persistance qui attribue l'`id`), et toute erreur est
 * propagée en rejet.
 *
 * `delete` prend un espace **refuge** et non un simple identifiant : le schéma
 * SQLite emporte les notes d'un espace supprimé (`ON DELETE CASCADE`), donc une
 * signature à un seul argument aurait fait de la perte de données le
 * comportement par défaut. Le transfert et la suppression sont atomiques côté
 * Rust ; il n'existe pas de variante sans refuge.
 */
export interface SpacesRepository {
  loadAll(): Promise<readonly Space[]>;
  create(draft: SpaceDraft): Promise<Space>;
  /** Renvoie l'espace renommé tel que persisté. */
  rename(id: string, draft: SpaceDraft): Promise<Space>;
  /** `targetSpaceId` recueille les notes de l'espace supprimé. */
  delete(id: string, targetSpaceId: string): Promise<void>;
}

export const SPACES_REPOSITORY = new InjectionToken<SpacesRepository>('SPACES_REPOSITORY');
