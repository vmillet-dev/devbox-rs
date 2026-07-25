import { InjectionToken } from '@angular/core';
import { Space } from '../models/space.model';

/**
 * Point d'accès aux espaces, sur le même modèle que `NOTES_REPOSITORY` : aucun
 * composant ne doit importer un jeu de données directement, sans quoi le
 * passage au backend Rust obligerait à retoucher les composants.
 *
 * En lecture seule pour l'instant — la création/suppression d'espaces n'est pas
 * encore une fonctionnalité de l'app.
 */
export interface SpacesRepository {
  loadAll(): Promise<readonly Space[]>;
}

export const SPACES_REPOSITORY = new InjectionToken<SpacesRepository>('SPACES_REPOSITORY');
