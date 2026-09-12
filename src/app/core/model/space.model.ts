export interface Space {
  readonly id: string;
  readonly name: string;
}

/** The `id` is assigned by persistence and never by the front end. */
export type SpaceDraft = Omit<Space, 'id'>;
