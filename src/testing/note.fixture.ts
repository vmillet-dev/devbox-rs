import { ChecklistItem } from '@features/notes/model/checklist.model';
import { Note } from '@features/notes/model/note.model';

/** Builds a fully-populated `Note` for tests, with sensible defaults overridable per test. */
export function createNote(overrides: Partial<Note> = {}): Note {
  const note: Note = {
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
    kind: 'snippet',
    items: [],
    // Derived by the backend (`notes::model::decorate`). The defaults mirror
    // what it returns for an ordinary note; a spec about footers, `{{fields}}`
    // or attachments overrides them.
    footer: { kind: 'age', at: new Date('2026-01-01T10:00:00Z') },
    expiringSoon: false,
    placeholders: [],
    attachmentCount: 0,
    copyText: null,
    ...overrides,
  };

  // Derived like the rest, but from what the caller passed: a spec asking for a
  // checklist should not also have to spell out its Markdown.
  return 'copyText' in overrides
    ? note
    : { ...note, copyText: note.kind === 'checklist' ? checklistMarkdown(note.items) : null };
}

/**
 * The one back-end rule the doubles reproduce: `notes::checklist::to_markdown`.
 * Exported so the fake repository does not write a second copy of it.
 */
export function checklistMarkdown(items: readonly ChecklistItem[]): string {
  return items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n');
}
