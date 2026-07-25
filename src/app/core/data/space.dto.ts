import { Space } from '../models/space.model';

/**
 * Un espace n'a aucun champ nécessitant une conversion (pas de date), mais il
 * garde son DTO pour que la frontière IPC reste explicite et symétrique avec
 * les notes : le jour où un champ typé s'y ajoute, le point de traduction existe déjà.
 */
export interface SpaceDto {
  readonly id: string;
  readonly name: string;
}

export function toSpace(dto: SpaceDto): Space {
  return { id: dto.id, name: dto.name };
}
