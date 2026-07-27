import { LanguageTag } from './language.model';

export type NoteLifecycle = { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: Date };

/**
 * Ce que le pied d'une carte affiche.
 *
 * La variante est **choisie par le back** (`domain::display`) : « une note
 * épinglée montre son contexte plutôt que son âge » est une règle produit, pas
 * une préoccupation de composant. Deux variantes portent une date et non un
 * libellé, pour que le texte vieillisse à l'écran sans aller-retour IPC.
 */
export type NoteFooter =
  | { readonly kind: 'source'; readonly value: string }
  | { readonly kind: 'expiry'; readonly at: Date }
  | { readonly kind: 'age'; readonly at: Date };

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
  /** Dérivé par le back, jamais écrit : voir [NoteFooter]. */
  readonly footer: NoteFooter;
  /** Échéance proche. Seuil unique, tenu par le back. */
  readonly expiringSoon: boolean;
}

/**
 * Champs fournis à la création. `id`, `createdAt` et `updatedAt` sont attribués
 * par la persistance ; `footer` et `expiringSoon` sont **dérivés** — les
 * envoyer laisserait croire que le front en décide.
 */
export type NoteDraft = Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'footer' | 'expiringSoon'>;

/** Modification partielle d'une note existante ; `updatedAt` est rafraîchi par la persistance. */
export type NotePatch = Partial<NoteDraft>;
