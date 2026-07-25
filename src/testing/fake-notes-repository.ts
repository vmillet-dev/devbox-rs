import { Note } from '../app/core/models/note.model';
import { NotesRepository } from '../app/core/data/notes-repository.token';

/** In-memory `NotesRepository` test double — resolves immediately with the notes it was given. */
export class FakeNotesRepository implements NotesRepository {
  constructor(private readonly notes: Note[] = []) {}

  loadAll(): Promise<Note[]> {
    return Promise.resolve(this.notes.map((note) => ({ ...note })));
  }
}
