import { describe, expect, it } from 'vitest';
import { createNote } from '@testing/note.fixture';
import { groupNotesIntoSections, toSearchResultsSection } from './notes-grouping.util';

const NOW = new Date('2026-01-10T12:00:00Z');

describe('groupNotesIntoSections', () => {
  it('puts pinned notes in a "pinned" section regardless of their date', () => {
    const note = createNote({ id: 'old-pinned', pinned: true, createdAt: new Date('2025-01-01T00:00:00Z') });

    const sections = groupNotesIntoSections([note], NOW);

    expect(sections[0]).toMatchObject({ key: 'pinned', notes: [note] });
  });

  it('puts notes created today into a "today" section', () => {
    const note = createNote({ id: 'today', createdAt: new Date('2026-01-10T08:00:00Z') });

    const sections = groupNotesIntoSections([note], NOW);

    expect(sections.find((section) => section.key === 'today')?.notes).toEqual([note]);
  });

  it('puts notes created within the last 7 days (excluding today) into a "week" section', () => {
    const note = createNote({ id: 'this-week', createdAt: new Date('2026-01-06T08:00:00Z') });

    const sections = groupNotesIntoSections([note], NOW);

    expect(sections.find((section) => section.key === 'week')?.notes).toEqual([note]);
  });

  it('puts unpinned notes older than 7 days into an "older" section', () => {
    const note = createNote({ id: 'ancient', createdAt: new Date('2025-12-01T08:00:00Z') });

    const sections = groupNotesIntoSections([note], NOW);

    expect(sections.find((section) => section.key === 'older')?.notes).toEqual([note]);
  });

  it('classifies every unpinned note into exactly one section, whatever its age', () => {
    // The guarantee that matters: a note missing from every section would be
    // unreachable in the UI, including through search.
    const notes = [
      createNote({ id: 'today', createdAt: new Date('2026-01-10T08:00:00Z') }),
      createNote({ id: 'week', createdAt: new Date('2026-01-06T08:00:00Z') }),
      createNote({ id: 'older', createdAt: new Date('2024-03-02T08:00:00Z') }),
      createNote({ id: 'future', createdAt: new Date('2027-01-01T08:00:00Z') }),
    ];

    const groupedIds = groupNotesIntoSections(notes, NOW).flatMap((section) =>
      section.notes.map((note) => note.id),
    );

    expect([...groupedIds].sort()).toEqual(['future', 'older', 'today', 'week']);
  });

  it('omits the "pinned", "today" and "older" sections when they have no notes', () => {
    const note = createNote({ id: 'this-week', createdAt: new Date('2026-01-06T08:00:00Z') });

    const sections = groupNotesIntoSections([note], NOW);

    expect(sections.map((section) => section.key)).toEqual(['week']);
  });

  it('always includes a "week" section with the create-ghost flag, even when empty', () => {
    const sections = groupNotesIntoSections([], NOW);

    expect(sections).toEqual([{ key: 'week', notes: [], hasExpiringNotes: false, showCreateGhost: true }]);
  });

  it('flags a section containing an expiring note', () => {
    const expiringNote = createNote({
      id: 'expiring',
      createdAt: new Date('2026-01-06T08:00:00Z'),
      lifecycle: { kind: 'expires', at: new Date('2026-01-12T00:00:00Z') },
    });

    const sections = groupNotesIntoSections([expiringNote], NOW);

    expect(sections.find((section) => section.key === 'week')?.hasExpiringNotes).toBe(true);
  });

  it('orders sections as pinned, today, week, then older', () => {
    const notes = [
      createNote({ id: 'older', createdAt: new Date('2025-01-01T08:00:00Z') }),
      createNote({ id: 'today', createdAt: new Date('2026-01-10T09:00:00Z') }),
      createNote({ id: 'pinned', pinned: true, createdAt: new Date('2026-01-10T08:00:00Z') }),
      createNote({ id: 'this-week', createdAt: new Date('2026-01-06T08:00:00Z') }),
    ];

    const sections = groupNotesIntoSections(notes, NOW);

    expect(sections.map((section) => section.key)).toEqual(['pinned', 'today', 'week', 'older']);
  });
});

describe('toSearchResultsSection', () => {
  it('returns a single flat section holding every note, with no create ghost', () => {
    const notes = [createNote({ id: 'a' }), createNote({ id: 'b' })];

    expect(toSearchResultsSection(notes)).toEqual({
      key: 'results',
      notes,
      hasExpiringNotes: false,
      showCreateGhost: false,
    });
  });

  it('flags expiring notes like the chronological sections do', () => {
    const notes = [createNote({ lifecycle: { kind: 'expires', at: new Date('2026-02-01') } })];

    expect(toSearchResultsSection(notes).hasExpiringNotes).toBe(true);
  });
});
