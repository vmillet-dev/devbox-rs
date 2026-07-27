import { Note } from '@core/models/note.model';

/** Builds a fully-populated `Note` for tests, with sensible defaults overridable per test. */
export function createNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    spaceId: 'space-1',
    title: 'Test note',
    language: 'txt',
    content: 'line one\nline two',
    source: 'Test / Fixture',
    tags: [],
    pinned: false,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    lifecycle: { kind: 'permanent' },
    // Derived by the backend (`domain::display`). The default mirrors what it
    // returns for an ordinary note; a spec about footers overrides it.
    footer: { kind: 'age', at: new Date('2026-01-01T10:00:00Z') },
    expiringSoon: false,
    ...overrides,
  };
}
