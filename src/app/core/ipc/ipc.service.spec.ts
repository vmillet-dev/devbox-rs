import { describe, expect, it } from 'vitest';
import { IpcError } from './ipc.service';

describe('IpcError', () => {
  it('keeps the failing command and the raw cause', () => {
    const error = new IpcError('create_note', 'database is locked');

    expect(error.command).toBe('create_note');
    expect(error.cause).toBe('database is locked');
  });

  it('builds a readable message from a string cause, which is what Rust Err values usually are', () => {
    const error = new IpcError('list_notes', 'no such table: notes');

    expect(error.message).toContain('list_notes');
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
    expect(new IpcError('saluer', 'x')).toBeInstanceOf(Error);
    expect(new IpcError('saluer', 'x').name).toBe('IpcError');
  });
});
