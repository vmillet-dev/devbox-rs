import { LanguageTag } from './language.model';

export type NoteLifecycle = { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: Date };

/**
 * La variante est choisie par le back : « une note épinglée montre son contexte
 * plutôt que son âge » est une règle produit. Deux variantes portent une date et
 * non un libellé, pour que le texte vieillisse sans aller-retour IPC.
 */
export type NoteFooter =
  | { readonly kind: 'source'; readonly value: string }
  | { readonly kind: 'expiry'; readonly at: Date }
  | { readonly kind: 'age'; readonly at: Date };

/** Immuable : toute modification produit un nouvel objet (voir `NotesStore`). */
export interface Note {
  readonly id: string;
  /** Jamais vide : une note vit forcément dans un espace. */
  readonly spaceId: string;
  /** Peut être vide (note tout juste créée) : l'UI affiche `notes.untitled`. */
  readonly title: string;
  readonly language: LanguageTag;
  readonly content: string;
  /** Contexte, ex. "API Gateway / Auth" — son premier segment sert de libellé. */
  readonly source: string;
  readonly tags: readonly string[];
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lifecycle: NoteLifecycle;
  /** Dérivé par le back, jamais écrit. */
  readonly footer: NoteFooter;
  /** Échéance proche. Seuil unique, tenu par le back. */
  readonly expiringSoon: boolean;
}

/**
 * `id` et les horodatages sont attribués par la persistance ; `footer` et
 * `expiringSoon` sont dérivés — les envoyer laisserait croire que le front décide.
 */
export type NoteDraft = Omit<Note, 'id' | 'createdAt' | 'updatedAt' | 'footer' | 'expiringSoon'>;

export type NotePatch = Partial<NoteDraft>;

/**
 * `untriaged` = notes portant une date d'expiration : une note éphémère est
 * précisément celle dont on n'a pas encore décidé du sort.
 */
export type NoteFilter = 'all' | 'pinned' | 'untriaged';

/** Envoyé tel quel à `query_notes` : le front décrit son intention. */
export interface NotesQuery {
  /** `null` = « tous les espaces », un choix et non une absence de choix. */
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  /** Même sémantique d'union que `tags` : au moins l'un d'eux. Vide = tous. */
  readonly languages: readonly LanguageTag[];
  /** Instant de référence, lu via `ClockService` pour rester testable. */
  readonly now: Date;
  /**
   * `Date#getTimezoneOffset()`. Les sections raisonnent en jours **locaux** :
   * sans ce décalage, une note créée à 23 h tomberait dans la mauvaise section.
   */
  readonly tzOffsetMinutes: number;
}

/**
 * Ce que le canevas affiche. Pas de liste plate ici : elle inviterait à
 * refiltrer ou re-trier ce que le backend a déjà fait.
 */
export interface NotesView {
  readonly sections: readonly NoteSection[];
  /** Tags du rail, portés à l'espace actif et non au filtre courant. */
  readonly availableTags: readonly string[];
  readonly availableLanguages: readonly LanguageTag[];
  /** Une recherche ou une sélection de facettes est active. */
  readonly isFiltering: boolean;
  readonly matched: number;
}

/**
 * `pinned` / `today` / `week` / `older` regroupent chronologiquement ;
 * `results` est la liste plate d'une recherche, où grouper par date masquerait
 * des résultats pertinents. La clé sert aussi de clé de traduction
 * (`'sections.' + key`).
 */
export type NoteSectionKey = 'pinned' | 'today' | 'week' | 'older' | 'results';

export interface NoteSection {
  readonly key: NoteSectionKey;
  readonly notes: readonly Note[];
  /** Au moins une note expire : le template en dérive `sections.expiringHint`. */
  readonly hasExpiringNotes: boolean;
  /** Affiche la carte fantôme « coller ou créer » en fin de section. */
  readonly showCreateGhost: boolean;
}
