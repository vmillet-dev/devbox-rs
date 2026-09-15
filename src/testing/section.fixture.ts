import { NoteSection, NoteSectionKey } from '@core/model/note.model';
import { Note } from '@core/model/note.model';

export function createSection(
  key: NoteSectionKey,
  notes: readonly Note[] = [],
  overrides: Partial<NoteSection> = {},
): NoteSection {
  return { key, notes, hasExpiringNotes: false, showCreateGhost: false, ...overrides };
}
