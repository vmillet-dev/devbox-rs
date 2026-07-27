import { Injectable, inject } from '@angular/core';
import { IpcService } from '../ipc/ipc.service';
import { Note, NoteDraft, NotePatch } from '../models/note.model';
import { NotesQuery, NotesView } from '../models/notes-query.model';
import { toNotesQueryDto, toNotesView } from './note-view.dto';
import { toNote, toNoteDraftDto, toNotePatchDto } from './note.dto';
import { NotesRepository } from './notes-repository.token';

/**
 * Dépôt de notes adossé aux commandes Rust — c'est la source de données active
 * de l'application (voir `data.providers.ts`).
 *
 * Les noms d'arguments et les types de retour ne sont plus déclarés ici : ils
 * viennent de `IpcContract`, qui les tient alignés sur les signatures Rust.
 */
@Injectable()
export class TauriNotesRepository implements NotesRepository {
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
