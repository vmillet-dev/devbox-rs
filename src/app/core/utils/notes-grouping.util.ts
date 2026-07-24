import { Note, NoteSection } from '../models/note.model';

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isWithinDays(date: Date, now: Date, days: number): boolean {
  const diffMs = now.getTime() - date.getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

/** Regroupe les notes filtrées en sections d'affichage : épinglées, aujourd'hui, cette semaine. */
export function groupNotesIntoSections(notes: readonly Note[], now: Date = new Date()): NoteSection[] {
  const pinned = notes.filter((note) => note.pinned);
  const unpinned = notes.filter((note) => !note.pinned);
  const today = unpinned.filter((note) => isSameDay(note.createdAt, now));
  const thisWeek = unpinned.filter((note) => !isSameDay(note.createdAt, now) && isWithinDays(note.createdAt, now, 7));

  const sections: NoteSection[] = [];

  if (pinned.length > 0) {
    sections.push({ key: 'pinned', title: 'Épinglées', notes: pinned });
  }
  if (today.length > 0) {
    sections.push({ key: 'today', title: "Aujourd'hui", notes: today });
  }

  sections.push({
    key: 'week',
    title: 'Cette semaine',
    hint: thisWeek.some((note) => note.lifecycle.kind === 'expires') ? 'à trier bientôt' : undefined,
    notes: thisWeek,
    showCreateGhost: true,
  });

  return sections;
}
