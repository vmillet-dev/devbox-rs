import { describe, expect, it } from 'vitest';
import { NotesQuery } from '../model/note.model';
import { NotesViewDto, toNotesQueryDto, toNotesView } from './note.dto';

const BASE_VIEW: NotesViewDto = {
  sections: [],
  availableTags: ['api'],
  availableLanguages: ['json', 'yml'],
  isFiltering: false,
  matched: 0,
};

const BASE_QUERY: NotesQuery = {
  spaceId: 'space-1',
  search: 'deploy',
  filter: 'all',
  tags: ['api'],
  languages: ['json'],
  now: new Date('2026-01-01T10:00:00.000Z'),
  tzOffsetMinutes: -120,
};

describe('toNotesQueryDto', () => {
  it('sends the selected languages across the bridge', () => {
    expect(toNotesQueryDto(BASE_QUERY).languages).toEqual(['json']);
  });

  it('sends an empty list rather than omitting the field', () => {
    // Rust deserialises `languages` as a required Vec: an absent key would make
    // the whole query fail to parse.
    expect(toNotesQueryDto({ ...BASE_QUERY, languages: [] }).languages).toEqual([]);
  });
});

describe('toNotesView', () => {
  it('reads the languages offered for the rail', () => {
    expect(toNotesView(BASE_VIEW).availableLanguages).toEqual(['json', 'yml']);
  });

  it('drops a language this build does not know rather than failing', () => {
    // A rail missing one facet stays usable; unlike an unknown section key,
    // which makes a whole part of the canvas unreadable and does throw.
    const view = toNotesView({ ...BASE_VIEW, availableLanguages: ['json', 'cobol'] });

    expect(view.availableLanguages).toEqual(['json']);
  });
});
