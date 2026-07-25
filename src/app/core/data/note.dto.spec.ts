import { describe, expect, it } from 'vitest';
import { Note, NoteDraft } from '@core/models/note.model';
import { NoteContractError, NoteDto, toNote, toNoteDraftDto, toNotePatchDto } from './note.dto';

const BASE_DTO: NoteDto = {
  id: 'note-1',
  title: 'Payload',
  language: 'json',
  content: '{}',
  source: 'API',
  tags: ['a'],
  pinned: false,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
  lifecycle: { kind: 'permanent' },
};

describe('toNote', () => {
  it('parses ISO date strings into Date instances', () => {
    // JSON has no date type: without this conversion every downstream
    // `getTime()` would produce NaN.
    const note = toNote(BASE_DTO);

    expect(note.createdAt).toBeInstanceOf(Date);
    expect(note.createdAt.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(note.updatedAt.toISOString()).toBe('2026-01-02T10:00:00.000Z');
  });

  it('parses the expiry date of an expiring lifecycle', () => {
    const note = toNote({ ...BASE_DTO, lifecycle: { kind: 'expires', at: '2026-03-01T00:00:00.000Z' } });

    expect(note.lifecycle).toEqual({ kind: 'expires', at: new Date('2026-03-01T00:00:00.000Z') });
  });

  it('copies the remaining fields verbatim', () => {
    const note = toNote(BASE_DTO);

    expect(note).toMatchObject({
      id: 'note-1',
      title: 'Payload',
      language: 'json',
      content: '{}',
      source: 'API',
      tags: ['a'],
      pinned: false,
    });
  });

  it('falls back to the default language when the backend reports an unknown one', () => {
    // A newer backend may know a language this front-end build does not; that
    // degrades the badge, it must not break the load.
    const note = toNote({ ...BASE_DTO, language: 'rust' });

    expect(note.language).toBe('txt');
  });

  it('throws a contract error on an unparseable date rather than yielding an Invalid Date', () => {
    expect(() => toNote({ ...BASE_DTO, createdAt: 'not-a-date' })).toThrow(NoteContractError);
  });

  it('throws a contract error on an unparseable expiry date', () => {
    expect(() => toNote({ ...BASE_DTO, lifecycle: { kind: 'expires', at: 'nope' } })).toThrow(
      NoteContractError,
    );
  });
});

describe('toNoteDraftDto', () => {
  it('serialises dates and omits the fields the backend owns', () => {
    const draft: NoteDraft = {
      title: 'New',
      language: 'txt',
      content: '',
      source: '',
      tags: [],
      pinned: false,
      lifecycle: { kind: 'expires', at: new Date('2026-05-01T00:00:00.000Z') },
    };

    const dto = toNoteDraftDto(draft);

    expect(dto).toEqual({
      title: 'New',
      language: 'txt',
      content: '',
      source: '',
      tags: [],
      pinned: false,
      lifecycle: { kind: 'expires', at: '2026-05-01T00:00:00.000Z' },
    });
    expect(dto).not.toHaveProperty('id');
    expect(dto).not.toHaveProperty('createdAt');
  });
});

describe('toNotePatchDto', () => {
  it('includes only the fields actually present in the patch', () => {
    // An explicit `undefined` would serialise to null and overwrite the stored
    // value instead of leaving it untouched.
    const dto = toNotePatchDto({ pinned: true });

    expect(dto).toEqual({ pinned: true });
    expect(Object.keys(dto)).toEqual(['pinned']);
  });

  it('keeps falsy values that were explicitly set', () => {
    const dto = toNotePatchDto({ title: '', pinned: false });

    expect(dto).toEqual({ title: '', pinned: false });
  });

  it('serialises a lifecycle change', () => {
    const patch: Partial<Note> = { lifecycle: { kind: 'expires', at: new Date('2026-06-01T00:00:00.000Z') } };

    expect(toNotePatchDto(patch)).toEqual({ lifecycle: { kind: 'expires', at: '2026-06-01T00:00:00.000Z' } });
  });

  it('produces an empty object for an empty patch', () => {
    expect(toNotePatchDto({})).toEqual({});
  });
});
