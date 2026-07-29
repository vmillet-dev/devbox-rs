export interface Space {
  readonly id: string;
  readonly name: string;
}

/**
 * Champs fournis à la création d'un espace. Comme pour les notes, l'`id` est
 * attribué par la couche de persistance, jamais par le front.
 */
export type SpaceDraft = Omit<Space, 'id'>;
