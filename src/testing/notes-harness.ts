import { TestBed } from '@angular/core/testing';
import { expect, vi } from 'vitest';
import { Note } from '@core/model/note.model';
import { Space } from '@core/model/space.model';
import { NoteSelectionStore } from '@core/state/note-selection.store';
import { NotesQueryStore } from '@core/state/notes-query.store';
import { NotesStore } from '@core/state/notes.store';
import { SpacesStore } from '@core/state/spaces.store';
import { FakeClipboard } from './fake-clipboard';
import { FakeNotesRepository } from './fake-notes-repository';
import { provideAppTesting } from './testing.providers';

/** The three notes stores are one object graph: testing one alone means faking two. */
export interface NotesHarness {
  readonly store: NotesStore;
  readonly canvas: NotesQueryStore;
  readonly selection: NoteSelectionStore;
  readonly repository: FakeNotesRepository;
  readonly spaces: SpacesStore;
  readonly clipboard: FakeClipboard;
}

/** `space-1` is the space the note fixture belongs to. */
export const HARNESS_SPACES: readonly Space[] = [
  { id: 'space-1', name: 'Space one', pinned: false },
  { id: 'space-2', name: 'Space two', pinned: false },
];

export async function createNotesHarness(
  notes: Note[] = [],
  spaces: readonly Space[] = HARNESS_SPACES,
  clipboard: FakeClipboard = new FakeClipboard(),
): Promise<NotesHarness> {
  const repository = new FakeNotesRepository(notes);
  TestBed.configureTestingModule({
    providers: [provideAppTesting({ notesRepository: repository, spaces, clipboard })],
  });

  const canvas = TestBed.inject(NotesQueryStore);
  const spacesStore = TestBed.inject(SpacesStore);
  await vi.waitFor(() => expect(canvas.isLoading()).toBe(false));
  await vi.waitFor(() => expect(spacesStore.spaces()).toHaveLength(spaces.length));

  return {
    store: TestBed.inject(NotesStore),
    canvas,
    selection: TestBed.inject(NoteSelectionStore),
    repository,
    spaces: spacesStore,
    clipboard,
  };
}

/** Notes as the canvas currently displays them, across every section. */
export function visibleIds(canvas: NotesQueryStore): string[] {
  return canvas.sections().flatMap((section) => section.notes.map((note) => note.id));
}

/** Waits for the repository to have been asked a further question. */
export async function awaitQuery(repository: FakeNotesRepository, previous: number): Promise<void> {
  await vi.waitFor(() => expect(repository.queryCount).toBeGreaterThan(previous));
}
