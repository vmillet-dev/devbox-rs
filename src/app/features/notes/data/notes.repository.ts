import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import { Note, NoteDraft, NotePatch, NotesQuery, NotesView } from '../model/note.model';
import { toNote, toNoteDraftDto, toNotePatchDto, toNotesQueryDto, toNotesView } from './note.dto';

/**
 * Point d'accès aux notes : ni composant ni store ne touche une source de
 * données autrement. Les signatures viennent de `bindings.ts`, généré depuis le
 * Rust — un argument mal nommé ou un type qui a bougé est une erreur de build.
 *
 * `query` renvoie une **vue déjà filtrée et regroupée** ; il n'existe pas de
 * méthode rendant la liste brute, précisément pour qu'aucun appelant ne soit
 * tenté de refiltrer. `create` et `update` renvoient la note **telle que
 * persistée** — l'`id` et les horodatages viennent du back, jamais du front.
 */
@Injectable({ providedIn: 'root' })
export class NotesRepository {
  async query(query: NotesQuery): Promise<NotesView> {
    return toNotesView(unwrap('query_notes', await commands.queryNotes(toNotesQueryDto(query))));
  }

  async create(draft: NoteDraft): Promise<Note> {
    return toNote(unwrap('create_note', await commands.createNote(toNoteDraftDto(draft))));
  }

  async update(id: string, patch: NotePatch): Promise<Note> {
    return toNote(unwrap('update_note', await commands.updateNote(id, toNotePatchDto(patch))));
  }

  async delete(id: string): Promise<void> {
    unwrap('delete_note', await commands.deleteNote(id));
  }
}
