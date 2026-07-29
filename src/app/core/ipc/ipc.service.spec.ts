import { describe, expect, it } from 'vitest';
import { IpcError } from './ipc.error';

describe('IpcError', () => {
  it('keeps the failing command and the raw cause', () => {
    const error = new IpcError('create_note', 'database is locked');

    expect(error.command).toBe('create_note');
    expect(error.cause).toBe('database is locked');
  });

  it('builds a readable message from a string cause, which is what Rust Err values usually are', () => {
    const error = new IpcError('query_notes', 'no such table: notes');

    expect(error.message).toContain('query_notes');
    expect(error.message).toContain('no such table: notes');
  });

  it('builds a readable message from an Error cause', () => {
    const error = new IpcError('delete_note', new Error('boom'));

    expect(error.message).toContain('boom');
  });

  it('falls back to a serialised form for structured causes', () => {
    const error = new IpcError('update_note', { code: 42 });

    expect(error.message).toContain('{"code":42}');
  });

  it('is an Error, so it survives being thrown and caught', () => {
    expect(new IpcError('list_spaces', 'x')).toBeInstanceOf(Error);
    expect(new IpcError('list_spaces', 'x').name).toBe('IpcError');
  });

  describe('structured causes', () => {
    it('exposes the code and params of an AppError so callers can branch on the cause', () => {
      // Discriminating on the code is what lets the UI show a translated
      // message instead of the French string Rust produced.
      const error = new IpcError('create_space', {
        code: 'duplicateSpaceName',
        params: { name: 'Perso' },
        detail: 'Un espace nommé « Perso » existe déjà',
      });

      expect(error.code).toBe('duplicateSpaceName');
      expect(error.params['name']).toBe('Perso');
    });

    it('uses the detail as the readable message', () => {
      const error = new IpcError('delete_note', {
        code: 'noteNotFound',
        params: { id: 'n-1' },
        detail: 'Note introuvable : n-1',
      });

      expect(error.message).toContain('Note introuvable : n-1');
    });

    it('reports no code when Tauri itself rejects with a string', () => {
      // An unknown command or an argument that fails to deserialise never
      // reaches our AppError, so the code has to stay optional.
      const error = new IpcError('query_notes', 'command not found');

      expect(error.code).toBeNull();
      expect(error.params).toEqual({});
    });

    it('reports no code for an object that is not an AppError', () => {
      const error = new IpcError('update_note', { unexpected: true });

      expect(error.code).toBeNull();
    });
  });
});
