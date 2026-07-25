import { Note } from './note.model';

/**
 * Sections d'affichage du canevas.
 * - `pinned` / `today` / `week` / `older` : regroupement chronologique par défaut.
 * - `results` : liste plate, utilisée quand une recherche ou un filtre par tag est actif
 *   (regrouper par date masquerait des résultats pertinents).
 *
 * La clé sert aussi de clé de traduction : le titre est `'sections.' + key`.
 */
export type NoteSectionKey = 'pinned' | 'today' | 'week' | 'older' | 'results';

export interface NoteSection {
  readonly key: NoteSectionKey;
  readonly notes: readonly Note[];
  /** Au moins une note de la section expire : le template en dérive l'indice `sections.expiringHint`. */
  readonly hasExpiringNotes: boolean;
  /** Affiche la carte fantôme « coller ou créer » à la fin de la section. */
  readonly showCreateGhost: boolean;
}
