import { LanguageTag } from './language.model';

export type NoteLifecycle = { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: Date };

/**
 * Une note est **immuable** : toute modification produit un nouvel objet
 * (voir `NotesStore`). Le `readonly` généralisé fait garantir cette règle par
 * le compilateur plutôt que par la discipline.
 */
export interface Note {
  readonly id: string;
  /** Espace auquel la note appartient — jamais vide : une note vit forcément dans un espace. */
  readonly spaceId: string;
  /** Peut être vide (note tout juste créée) : l'UI affiche alors `notes.untitled`. */
  readonly title: string;
  readonly language: LanguageTag;
  readonly content: string;
  /** Chemin de contexte, ex. "API Gateway / Auth" — le premier segment sert de libellé compact sur la carte. */
  readonly source: string;
  readonly tags: readonly string[];
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lifecycle: NoteLifecycle;
}

/**
 * Champs fournis à la création. `id`, `createdAt` et `updatedAt` sont attribués
 * par la couche de persistance (le backend Rust une fois branché), jamais par le front.
 */
export type NoteDraft = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;

/** Modification partielle d'une note existante ; `updatedAt` est rafraîchi par la persistance. */
export type NotePatch = Partial<NoteDraft>;
