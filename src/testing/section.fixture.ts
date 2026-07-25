import { NoteSection, NoteSectionKey } from '@core/models/note-section.model';
import { Note } from '@core/models/note.model';

/** Builds a `NoteSection` for tests without repeating every flag at each call site. */
export function createSection(
  key: NoteSectionKey,
  notes: readonly Note[] = [],
  overrides: Partial<NoteSection> = {},
): NoteSection {
  return { key, notes, hasExpiringNotes: false, showCreateGhost: false, ...overrides };
}
