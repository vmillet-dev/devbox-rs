import { describe, expect, it } from 'vitest';
import { createNote } from '../../../testing/note.fixture';
import { groupNotesIntoSections } from './notes-grouping.util';

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
    const todaySection = sections.find((section) => section.key === 'today');

    expect(todaySection?.notes).toEqual([note]);
  });

  it('puts notes created within the last 7 days (excluding today) into a "week" section', () => {
    const note = createNote({ id: 'this-week', createdAt: new Date('2026-01-06T08:00:00Z') });

    const sections = groupNotesIntoSections([note], NOW);
    const weekSection = sections.find((section) => section.key === 'week');

    expect(weekSection?.notes).toEqual([note]);
  });

  it('excludes unpinned notes older than 7 days from every section', () => {
    const note = createNote({ id: 'too-old', createdAt: new Date('2025-12-01T08:00:00Z') });

    const sections = groupNotesIntoSections([note], NOW);
    const allGroupedNotes = sections.flatMap((section) => section.notes);

    expect(allGroupedNotes).not.toContain(note);
  });

  it('omits the "pinned" and "today" sections when they have no notes', () => {
    const note = createNote({ id: 'this-week', createdAt: new Date('2026-01-06T08:00:00Z') });

    const sections = groupNotesIntoSections([note], NOW);

    expect(sections.map((section) => section.key)).toEqual(['week']);
  });

  it('always includes a "week" section with the create-ghost flag, even when empty', () => {
    const sections = groupNotesIntoSections([], NOW);

    expect(sections).toEqual([
      { key: 'week', title: 'Cette semaine', hint: undefined, notes: [], showCreateGhost: true },
    ]);
  });

  it('sets a hint on the "week" section when one of its notes is expiring', () => {
    const expiringNote = createNote({
      id: 'expiring',
      createdAt: new Date('2026-01-06T08:00:00Z'),
      lifecycle: { kind: 'expires', at: new Date('2026-01-12T00:00:00Z') },
    });

    const sections = groupNotesIntoSections([expiringNote], NOW);
    const weekSection = sections.find((section) => section.key === 'week');

    expect(weekSection?.hint).toBe('à trier bientôt');
  });

  it('orders sections as pinned, today, then week', () => {
    const pinned = createNote({ id: 'pinned', pinned: true, createdAt: new Date('2026-01-10T08:00:00Z') });
    const today = createNote({ id: 'today', createdAt: new Date('2026-01-10T09:00:00Z') });
    const thisWeek = createNote({ id: 'this-week', createdAt: new Date('2026-01-06T08:00:00Z') });

    const sections = groupNotesIntoSections([today, pinned, thisWeek], NOW);

    expect(sections.map((section) => section.key)).toEqual(['pinned', 'today', 'week']);
  });
});
