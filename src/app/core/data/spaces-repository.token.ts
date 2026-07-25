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
 * TODO(feature) : renommage et suppression d'espaces. La suppression demande
 * d'abord une décision produit — que deviennent les notes de l'espace supprimé
 * (suppression en cascade, ou déplacement vers un espace par défaut) ? Le champ
 * `spaceId` d'une note est déjà modifiable via `NotePatch`, donc le déplacement
 * ne demanderait qu'une commande Rust et une entrée de menu.
 */
export interface SpacesRepository {
  loadAll(): Promise<readonly Space[]>;
  create(draft: SpaceDraft): Promise<Space>;
}

export const SPACES_REPOSITORY = new InjectionToken<SpacesRepository>('SPACES_REPOSITORY');
