import { Injectable, inject } from '@angular/core';
import { IpcService } from '../ipc/ipc.service';
import { Note, NoteDraft, NotePatch } from '../models/note.model';
import { NoteDto, toNote, toNoteDraftDto, toNotePatchDto } from './note.dto';
import { NotesRepository } from './notes-repository.token';

/**
 * Implémentation réelle du dépôt de notes, adossée aux commandes Rust.
 *
 * ⚠️ Pas encore activée : les commandes correspondantes n'existent pas dans
 * `src-tauri/src/commands/notes.rs`. Pour basculer une fois le backend prêt,
 * un seul endroit à changer — `data.providers.ts`.
 *
 * Les noms d'arguments (`draft`, `id`, `patch`) doivent correspondre
 * **exactement** aux paramètres des fonctions Rust : Tauri apparie par nom, pas
 * par position.
 */
@Injectable()
export class TauriNotesRepository implements NotesRepository {
  private readonly ipc = inject(IpcService);

  async loadAll(): Promise<readonly Note[]> {
    const dtos = await this.ipc.invoke<NoteDto[]>('list_notes');
    return dtos.map(toNote);
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
