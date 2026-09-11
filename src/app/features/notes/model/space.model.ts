export interface Space {
  readonly id: string;
  readonly name: string;
}

/**
 * The fields supplied when creating a space. As for the notes, the `id` is
 * assigned by persistence and never by the front.
 */
export type SpaceDraft = Omit<Space, 'id'>;
