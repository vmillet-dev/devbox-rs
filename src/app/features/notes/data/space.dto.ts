import { Space, SpaceDraft } from '../model/space.model';

/**
 * Un espace n'a aucun champ à convertir : le DTO est structurellement identique
 * au modèle, d'où des alias plutôt que des mappeurs identité.
 */
export type SpaceDto = Space;
export type SpaceDraftDto = SpaceDraft;
