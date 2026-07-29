import { describe, expect, it } from 'vitest';
import { IpcError } from '@core/ipc/ipc.error';
import { ipcNotice } from './error-notifier.service';

const FALLBACK = { key: 'errors.noteSaveFailed' };

function failure(code: string, params: Record<string, string> = {}): IpcError {
  return new IpcError('update_note', { code, params, detail: 'détail technique' });
}

describe('ipcNotice', () => {
  it('prefers the message naming the cause over the one naming the attempted action', () => {
    // "This note no longer exists" tells the user what to do next; "could not
    // save" leaves them retrying something that can never succeed.
    const notice = ipcNotice(failure('noteNotFound', { id: 'n-1' }), FALLBACK);

    expect(notice.ref.key).toBe('errors.noteGone');
  });

  it('falls back to the attempted action when the cause adds nothing useful', () => {
    // A generic SQLite failure has no actionable wording of its own.
    const notice = ipcNotice(failure('storage'), FALLBACK);

    expect(notice.ref.key).toBe('errors.noteSaveFailed');
  });

  it('falls back when Tauri itself rejected, which carries no code', () => {
    const notice = ipcNotice(new IpcError('update_note', 'command not found'), FALLBACK);

    expect(notice.ref.key).toBe('errors.noteSaveFailed');
  });

  it('falls back for a plain error that never crossed the bridge', () => {
    const notice = ipcNotice(new Error('boom'), FALLBACK);

    expect(notice.ref.key).toBe('errors.noteSaveFailed');
    expect(notice.detail).toBe('boom');
  });

  it('carries the backend parameters through for interpolation', () => {
    const notice = ipcNotice(failure('duplicateSpaceName', { name: 'Perso' }), FALLBACK);

    expect(notice.ref).toEqual({ key: 'errors.spaceNameTaken', params: { name: 'Perso' } });
  });

  it('lets the backend parameters win over the caller defaults', () => {
    const notice = ipcNotice(failure('duplicateSpaceName', { name: 'Perso' }), FALLBACK, {
      name: 'saisi',
    });

    expect(notice.ref.params).toEqual({ name: 'Perso' });
  });

  it('keeps the caller default when the backend sent no parameter to interpolate', () => {
    // Without it the banner would render a literal {{name}}.
    const notice = ipcNotice(failure('duplicateSpaceName'), FALLBACK, { name: 'saisi' });

    expect(notice.ref.params).toEqual({ name: 'saisi' });
  });

  it('keeps the technical detail as secondary text in every case', () => {
    expect(ipcNotice(failure('noteNotFound'), FALLBACK).detail).toBe(
      'La commande Tauri « update_note » a échoué : détail technique',
    );
  });

  it('ignores a code this build does not know rather than trusting it blindly', () => {
    // A newer backend variant reaches `code === null`, so the caller's message
    // is used instead of looking up a key that does not exist.
    const notice = ipcNotice(failure('quantumFluctuation'), FALLBACK);

    expect(notice.ref.key).toBe('errors.noteSaveFailed');
  });
});
