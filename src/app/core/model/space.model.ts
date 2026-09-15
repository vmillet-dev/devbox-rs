export interface Space {
  readonly id: string;
  readonly name: string;
  /** Hoisted to the head of the list, the way a pinned note is on the canvas. */
  readonly pinned: boolean;
}

/** The `id` is assigned by persistence and never by the front end. */
export type SpaceDraft = Omit<Space, 'id' | 'pinned'>;
