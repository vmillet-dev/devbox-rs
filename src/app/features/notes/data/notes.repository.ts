import { Injectable, inject } from '@angular/core';
import { IpcService } from '@core/ipc/ipc.service';
import { Note, NoteDraft, NotePatch, NotesQuery, NotesView } from '../model/note.model';
import { toNote, toNoteDraftDto, toNotePatchDto, toNotesQueryDto, toNotesView } from './note.dto';

/**
 * Point d'accès aux notes : ni composant ni store ne touche une source de
 * données autrement. Les noms d'arguments et les types de retour viennent
 * d'`IpcContract`, qui les tient alignés sur les signatures Rust.
 *
 * `query` renvoie une **vue déjà filtrée et regroupée** ; il n'existe pas de
 * méthode rendant la liste brute, précisément pour qu'aucun appelant ne soit
 * tenté de refiltrer. `create` et `update` renvoient la note **telle que
 * persistée** — l'`id` et les horodatages viennent du back, jamais du front.
 */
@Injectable({ providedIn: 'root' })
export class NotesRepository {
  private readonly ipc = inject(IpcService);

  async query(query: NotesQuery): Promise<NotesView> {
    return toNotesView(await this.ipc.invoke('query_notes', { query: toNotesQueryDto(query) }));
  }

  async create(draft: NoteDraft): Promise<Note> {
    return toNote(await this.ipc.invoke('create_note', { draft: toNoteDraftDto(draft) }));
  }

  async update(id: string, patch: NotePatch): Promise<Note> {
    return toNote(await this.ipc.invoke('update_note', { id, patch: toNotePatchDto(patch) }));
  }

  async delete(id: string): Promise<void> {
    await this.ipc.invoke('delete_note', { id });
  }
}
