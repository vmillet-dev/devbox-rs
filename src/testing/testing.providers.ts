import { Provider } from '@angular/core';
import { NOTES_REPOSITORY } from '@core/data/notes-repository.token';
import { SPACES_REPOSITORY } from '@core/data/spaces-repository.token';
import { Note } from '@core/models/note.model';
import { Space } from '@core/models/space.model';
import { FakeNotesRepository } from './fake-notes-repository';
import { FakeSpacesRepository } from './fake-spaces-repository';
import { provideTranslocoTesting } from './provide-transloco-testing';

interface DataDoubles {
  readonly notes?: readonly Note[];
  readonly spaces?: readonly Space[];
  /** Pass an existing fake to keep a handle on it (e.g. to set `failNext`). */
  readonly notesRepository?: FakeNotesRepository;
}

/**
 * Providers for any spec whose component transitively needs a store or the
 * `transloco` pipe. Bundled here so a new data seam doesn't have to be added to
 * a dozen spec files one by one.
 */
export function provideAppTesting(doubles: DataDoubles = {}): Provider[] {
  return [
    {
      provide: NOTES_REPOSITORY,
      useValue: doubles.notesRepository ?? new FakeNotesRepository(doubles.notes ?? []),
    },
    { provide: SPACES_REPOSITORY, useValue: new FakeSpacesRepository(doubles.spaces ?? []) },
    provideTranslocoTesting(),
  ];
}
