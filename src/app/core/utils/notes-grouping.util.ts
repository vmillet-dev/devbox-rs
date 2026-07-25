import { NoteSection, NoteSectionKey } from '../models/note-section.model';
import { Note } from '../models/note.model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isWithinDays(date: Date, now: Date, days: number): boolean {
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= days * MS_PER_DAY;
}

function buildSection(key: NoteSectionKey, notes: readonly Note[], showCreateGhost = false): NoteSection {
  return {
    key,
    notes,
    hasExpiringNotes: notes.some((note) => note.lifecycle.kind === 'expires'),
    showCreateGhost,
  };
}

/**
 * Regroupe les notes filtrées en sections chronologiques.
 *
 * Le classement est **exhaustif** : hors notes épinglées, chaque note tombe
 * dans exactement une section parmi `today`, `week` et `older`. C'est une
 * garantie, pas un détail — une note n'appartenant à aucune section serait
 * introuvable dans l'interface, y compris via la recherche.
 */
export function groupNotesIntoSections(notes: readonly Note[], now: Date): NoteSection[] {
  const pinned = notes.filter((note) => note.pinned);
  const unpinned = notes.filter((note) => !note.pinned);

  const today = unpinned.filter((note) => isSameDay(note.createdAt, now));
  const thisWeek = unpinned.filter(
    (note) => !isSameDay(note.createdAt, now) && isWithinDays(note.createdAt, now, WEEK_DAYS),
  );
  const older = unpinned.filter(
    (note) => !isSameDay(note.createdAt, now) && !isWithinDays(note.createdAt, now, WEEK_DAYS),
  );

  const sections: NoteSection[] = [];

  if (pinned.length > 0) {
    sections.push(buildSection('pinned', pinned));
  }
  if (today.length > 0) {
    sections.push(buildSection('today', today));
  }

  // Toujours présente : c'est elle qui héberge la carte « coller ou créer ».
  sections.push(buildSection('week', thisWeek, true));

  if (older.length > 0) {
    sections.push(buildSection('older', older));
  }

  return sections;
}

/**
 * Vue plate utilisée dès qu'une recherche ou un filtre par tag est actif.
 *
 * Répartir des résultats de recherche dans des sections de date les dilue et,
 * surtout, laisse croire qu'il n'y a rien à voir quand tout est tombé dans une
 * section en bas de page. Un résultat de recherche se lit en liste.
 */
export function toSearchResultsSection(notes: readonly Note[]): NoteSection {
  return buildSection('results', notes);
}
