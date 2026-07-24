import { Injectable } from '@angular/core';
import { Note } from '../models/note.model';
import { NotesRepository } from './notes-repository.token';
import { MOCK_NOTES } from './notes.mock-data';

@Injectable()
export class MockNotesRepository implements NotesRepository {
  loadAll(): Promise<Note[]> {
    return Promise.resolve(MOCK_NOTES.map((note) => ({ ...note })));
  }
}
