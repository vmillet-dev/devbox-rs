import { Injectable, inject } from '@angular/core';
import { IpcService } from '../ipc/ipc.service';
import { Note, NoteDraft, NotePatch } from '../models/note.model';
import { NotesQuery, NotesView } from '../models/notes-query.model';
import { NotesViewDto, toNotesQueryDto, toNotesView } from './note-view.dto';
import { NoteDto, toNote, toNoteDraftDto, toNotePatchDto } from './note.dto';
import { NotesRepository } from './notes-repository.token';

/**
 * Dépôt de notes adossé aux commandes Rust — c'est la source de données active
 * de l'application (voir `data.providers.ts`).
 *
 * Les noms d'arguments (`query`, `draft`, `id`, `patch`) doivent correspondre
 * **exactement** aux paramètres des fonctions Rust : Tauri apparie par nom, pas
 * par position.
 */
@Injectable()
export class TauriNotesRepository implements NotesRepository {
  private readonly ipc = inject(IpcService);

  async query(query: NotesQuery): Promise<NotesView> {
    const dto = await this.ipc.invoke<NotesViewDto>('query_notes', {
      query: toNotesQueryDto(query),
    });
    return toNotesView(dto);
  }

  async create(draft: NoteDraft): Promise<Note> {
    const dto = await this.ipc.invoke<NoteDto>('create_note', { draft: toNoteDraftDto(draft) });
    return toNote(dto);
  }

  async update(id: string, patch: NotePatch): Promise<Note> {
    const dto = await this.ipc.invoke<NoteDto>('update_note', { id, patch: toNotePatchDto(patch) });
    return toNote(dto);
  }

  async delete(id: string): Promise<void> {
    await this.ipc.invoke<void>('delete_note', { id });
  }
}
