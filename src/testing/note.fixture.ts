import { Note } from '@features/notes/model/note.model';

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
    // Derived by the backend (`notes::model::decorate`). The defaults mirror
    // what it returns for an ordinary note; a spec about footers, `{{fields}}`
    // or attachments overrides them.
    footer: { kind: 'age', at: new Date('2026-01-01T10:00:00Z') },
    expiringSoon: false,
    placeholders: [],
    attachmentCount: 0,
    ...overrides,
  };
}
