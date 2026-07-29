import { Provider } from '@angular/core';
import { NotesRepository } from '@features/notes/data/notes.repository';
import { SpacesRepository } from '@features/notes/data/spaces.repository';
import { AppInfoService } from '@core/app-info/app-info.service';
import { Note } from '@features/notes/model/note.model';
import { Space } from '@features/notes/model/space.model';
import { UpdaterService } from '@core/updates/updater.service';
import { FakeAppInfo } from './fake-app-info';
import { FakeNotesRepository } from './fake-notes-repository';
import { FakeSpacesRepository } from './fake-spaces-repository';
import { FakeUpdater } from './fake-updater';
import { provideTranslocoTesting } from './provide-transloco-testing';

interface DataDoubles {
  readonly notes?: readonly Note[];
  readonly spaces?: readonly Space[];
  /** Pass an existing fake to keep a handle on it (e.g. to set `failNext`). */
  readonly notesRepository?: FakeNotesRepository;
  readonly spacesRepository?: FakeSpacesRepository;
  readonly updater?: FakeUpdater;
  readonly appInfo?: FakeAppInfo;
}

/**
 * Providers for any spec whose component transitively needs a store or the
 * `transloco` pipe. Bundled here so a new data seam doesn't have to be added to
 * a dozen spec files one by one.
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
    // The shell hosts the update prompt and the about menu, so every spec
    // reaching it transitively pulls these two — and with them the Tauri bridge,
    // absent under jsdom.
    { provide: UpdaterService, useValue: doubles.updater ?? new FakeUpdater() },
    { provide: AppInfoService, useValue: doubles.appInfo ?? new FakeAppInfo() },
    provideTranslocoTesting(),
  ];
}
