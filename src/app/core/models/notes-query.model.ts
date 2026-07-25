import { NoteSection } from './note-section.model';

/**
 * `untriaged` = notes portant une date d'expiration. Dans le modèle du produit,
 * une note éphémère est précisément une note dont on n'a pas encore décidé du
 * sort — d'où le libellé « à trier ».
 */
export type NoteFilter = 'all' | 'pinned' | 'untriaged';

/**
 * Ce que l'utilisateur demande à voir. Envoyé tel quel à `query_notes` : le
 * front décrit son intention, le backend décide de ce qui s'affiche.
 */
export interface NotesQuery {
  /** `null` = « tous les espaces », un choix et non une absence de choix. */
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  /** Instant de référence, lu via `ClockService` pour rester testable. */
  readonly now: Date;
  /**
   * `Date#getTimezoneOffset()`. Les sections raisonnent en jours **locaux** :
   * sans ce décalage, une note créée à 23 h tomberait dans la mauvaise section.
   */
  readonly tzOffsetMinutes: number;
}

/**
 * Ce que le canevas affiche. Il n'y a volontairement pas de liste plate ici :
 * la trouver inviterait à refiltrer ou re-trier côté front, ce que le backend
 * a déjà fait.
 */
export interface NotesView {
  readonly sections: readonly NoteSection[];
  /** Tags du rail, portés à l'espace actif et non au filtre courant. */
  readonly availableTags: readonly string[];
  /** Une recherche ou une sélection de tags est active. */
  readonly isFiltering: boolean;
  /** Nombre de notes retenues, toutes sections confondues. */
  readonly matched: number;
}
