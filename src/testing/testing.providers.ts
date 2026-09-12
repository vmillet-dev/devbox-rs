import { Provider } from '@angular/core';
import { CLIPBOARD_ADAPTER } from '@core/clipboard/clipboard.service';
import { FILE_DIALOG_ADAPTER } from '@core/dialogs/file-dialog.service';
import { APP_WINDOW_ADAPTER } from '@core/window/app-window.service';
import { AttachmentsRepository } from '@features/notes/data/attachments.repository';
import { NotesRepository } from '@features/notes/data/notes.repository';
import { SpacesRepository } from '@features/notes/data/spaces.repository';
import { TransferRepository } from '@features/notes/data/transfer.repository';
import { AppInfoService } from '@core/app-info/app-info.service';
import { Note } from '@features/notes/model/note.model';
import { Space } from '@features/notes/model/space.model';
import { UpdaterService } from '@core/updates/updater.service';
import { FakeAppInfo } from './fake-app-info';
import { FakeAppWindow } from './fake-app-window';
import { FakeAttachmentsRepository } from './fake-attachments-repository';
import { FakeClipboard } from './fake-clipboard';
import { FakeFileDialog } from './fake-file-dialog';
import { FakeNotesRepository } from './fake-notes-repository';
import { FakeSpacesRepository } from './fake-spaces-repository';
import { FakeTransferRepository } from './fake-transfer-repository';
import { FakeUpdater } from './fake-updater';
import { provideTranslocoTesting } from './provide-transloco-testing';

interface DataDoubles {
  readonly notes?: readonly Note[];
  readonly spaces?: readonly Space[];
  /** Pass an existing fake to keep a handle on it (e.g. to set `failNext`). */
  readonly notesRepository?: FakeNotesRepository;
  readonly spacesRepository?: FakeSpacesRepository;
  readonly attachmentsRepository?: FakeAttachmentsRepository;
  readonly transferRepository?: FakeTransferRepository;
  readonly updater?: FakeUpdater;
  readonly appInfo?: FakeAppInfo;
  readonly clipboard?: FakeClipboard;
  readonly fileDialog?: FakeFileDialog;
  readonly appWindow?: FakeAppWindow;
}

/**
 * Providers for any spec whose component transitively needs a store or the `transloco`
 * pipe: bundled here so a new data seam is not added to a dozen spec files one by one.
 */
export function provideAppTesting(doubles: DataDoubles = {}): Provider[] {
  return [
    {
      provide: NotesRepository,
      useValue: doubles.notesRepository ?? new FakeNotesRepository(doubles.notes ?? []),
    },
    {
      provide: SpacesRepository,
      useValue: doubles.spacesRepository ?? new FakeSpacesRepository(doubles.spaces ?? []),
    },
    {
      provide: AttachmentsRepository,
      useValue: doubles.attachmentsRepository ?? new FakeAttachmentsRepository(),
    },
    {
      provide: TransferRepository,
      useValue: doubles.transferRepository ?? new FakeTransferRepository(),
    },
    // The shell hosts the update prompt and the about menu, so every spec reaching it
    // pulls the Tauri bridge, absent under jsdom.
    { provide: UpdaterService, useValue: doubles.updater ?? new FakeUpdater() },
    { provide: AppInfoService, useValue: doubles.appInfo ?? new FakeAppInfo() },
    { provide: CLIPBOARD_ADAPTER, useValue: doubles.clipboard ?? new FakeClipboard() },
    { provide: FILE_DIALOG_ADAPTER, useValue: doubles.fileDialog ?? new FakeFileDialog() },
    // Never the real one: `exit()` would take the test runner down with it.
    { provide: APP_WINDOW_ADAPTER, useValue: doubles.appWindow ?? new FakeAppWindow() },
    provideTranslocoTesting(),
  ];
}
