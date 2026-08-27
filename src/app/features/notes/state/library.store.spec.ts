import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { StatusNotifier } from '@core/notifications/status.service';
import { FakeClipboard } from '@testing/fake-clipboard';
import { FakeFileDialog } from '@testing/fake-file-dialog';
import { FakeTransferRepository } from '@testing/fake-transfer-repository';
import { provideAppTesting } from '@testing/testing.providers';
import { LibraryStore } from './library.store';

const NOW = new Date('2026-08-27T09:00:00Z');

interface Harness {
  readonly store: LibraryStore;
  readonly repository: FakeTransferRepository;
  readonly dialog: FakeFileDialog;
  readonly clipboard: FakeClipboard;
  readonly status: StatusNotifier;
  readonly notifier: ErrorNotifier;
}

function createStore(): Harness {
  TestBed.resetTestingModule();
  const repository = new FakeTransferRepository();
  const dialog = new FakeFileDialog();
  const clipboard = new FakeClipboard();
  TestBed.configureTestingModule({
    providers: [provideAppTesting({ transferRepository: repository, fileDialog: dialog, clipboard })],
  });

  return {
    store: TestBed.inject(LibraryStore),
    repository,
    dialog,
    clipboard,
    status: TestBed.inject(StatusNotifier),
    notifier: TestBed.inject(ErrorNotifier),
  };
}

describe('LibraryStore', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createStore();
  });

  describe('import', () => {
    it('does nothing when the dialog is cancelled', async () => {
      harness.dialog.openPath = null;

      expect(await harness.store.import()).toBe(false);
      expect(harness.repository.importedFrom).toBeNull();
      expect(harness.status.status()).toBeNull();
    });

    it('reports what came in, naming the file it read', async () => {
      harness.dialog.openPath = 'C:/notes/devbox-2026-08-27.json';

      expect(await harness.store.import()).toBe(true);
      expect(harness.status.status()).toEqual({
        key: 'file.imported',
        params: { notes: '2', skipped: '0', path: 'devbox-2026-08-27.json' },
      });
    });

    it('says so plainly when everything was already there', async () => {
      // Le geste que fait tout le monde : exporter puis réimporter aussitôt.
      // Sans message, l'application a l'air de n'avoir rien fait.
      harness.dialog.openPath = 'C:/in.json';
      harness.repository.importReport = { spacesCreated: 0, notesImported: 0, notesSkipped: 4 };

      expect(await harness.store.import()).toBe(false);
      expect(harness.status.status()?.key).toBe('file.importedNothing');
      expect(harness.status.status()?.params).toMatchObject({ skipped: '4' });
    });

    it('surfaces a failure and leaves no success message behind', async () => {
      harness.dialog.openPath = 'C:/in.json';
      harness.repository.failNext = new Error('boom');

      expect(await harness.store.import()).toBe(false);
      expect(harness.notifier.notice()?.ref.key).toBe('errors.importFailed');
      expect(harness.status.status()).toBeNull();
    });
  });

  describe('export', () => {
    it('proposes a dated file name', async () => {
      harness.dialog.savePath = 'C:/out.json';

      await harness.store.export(null, NOW);

      expect(harness.dialog.saveCalls[0].defaultPath).toBe('devbox-2026-08-27.json');
    });

    it('passes the active space through, or null for everything', async () => {
      harness.dialog.savePath = 'C:/out.json';

      await harness.store.export('space-1', NOW);
      expect(harness.repository.exportedTo).toEqual({ path: 'C:/out.json', spaceId: 'space-1' });

      await harness.store.export(null, NOW);
      expect(harness.repository.exportedTo?.spaceId).toBeNull();
    });

    it('writes nothing when no destination is chosen', async () => {
      harness.dialog.savePath = null;

      await harness.store.export(null, NOW);

      expect(harness.repository.exportedTo).toBeNull();
      expect(harness.status.status()).toBeNull();
    });

    it('says how many notes went out, and where', async () => {
      // Un export réussi dont on ne sait pas où il a atterri ne sert à rien.
      harness.dialog.savePath = 'C:/backups/devbox.json';

      await harness.store.export(null, NOW);

      expect(harness.status.status()).toEqual({
        key: 'file.exported',
        params: { notes: '3', path: 'devbox.json' },
      });
    });

    it('does not pretend to have exported an empty library', async () => {
      harness.dialog.savePath = 'C:/out.json';
      harness.repository.exportReport = { notes: 0, spaces: 0 };

      await harness.store.export(null, NOW);

      expect(harness.status.status()?.key).toBe('file.emptyLibrary');
    });

    it('restricts the file to the selection when asked', async () => {
      harness.dialog.savePath = 'C:/out.json';

      await harness.store.exportSelection(['note-1', 'note-2'], NOW);

      expect(harness.repository.exportedIds).toEqual(['note-1', 'note-2']);
      expect(harness.status.status()?.params).toMatchObject({ notes: '2' });
    });

    it('asks for a selection rather than exporting everything', async () => {
      await harness.store.exportSelection([], NOW);

      expect(harness.notifier.notice()?.ref.key).toBe('file.needsSelection');
      expect(harness.dialog.saveCalls).toHaveLength(0);
    });
  });

  describe('copy as Markdown', () => {
    it('asks for a selection rather than copying everything', async () => {
      await harness.store.copyAsMarkdown([]);

      expect(harness.notifier.notice()?.ref.key).toBe('file.needsSelection');
      expect(harness.repository.sharedIds).toBeNull();
    });

    it('puts the markdown in the clipboard and goes no further', async () => {
      // « Partager » s'arrête au presse-papier : rien n'est envoyé nulle part.
      await harness.store.copyAsMarkdown(['note-1', 'note-2']);

      expect(harness.repository.sharedIds).toEqual(['note-1', 'note-2']);
      expect(harness.clipboard.content).toBe(harness.repository.markdown);
      expect(harness.status.status()).toEqual({
        key: 'file.copied',
        params: { notes: '2' },
      });
    });

    it('says so when the clipboard refuses', async () => {
      harness.clipboard.failNext = new Error('no clipboard');

      await harness.store.copyAsMarkdown(['note-1']);

      expect(harness.notifier.notice()?.ref.key).toBe('errors.copyFailed');
      expect(harness.status.status()).toBeNull();
    });
  });

  it('is idle again once an operation ends', async () => {
    harness.dialog.openPath = 'C:/in.json';

    await harness.store.import();

    expect(harness.store.isBusy()).toBe(false);
  });
});
