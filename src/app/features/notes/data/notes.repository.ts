import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import {
  Note,
  NoteDraft,
  NotePatch,
  NotesQuery,
  NotesView,
  TagUsage,
  TrashedNote,
} from '../model/note.model';
import {
  toNote,
  toWireNoteDraft,
  toWireNotePatch,
  toWireNotesQuery,
  toNotesView,
  toTrashedNote,
} from './note.mapper';

/**
 * The way in to the notes: no component or store touches a data source otherwise.
 *
 * `query` returns a view **already filtered and grouped**, and there is deliberately no
 * method handing back the raw list, so no caller is tempted to re-filter.
 */
@Injectable({ providedIn: 'root' })
export class NotesRepository {
  async query(query: NotesQuery): Promise<NotesView> {
    return toNotesView(unwrap('query_notes', await commands.queryNotes(toWireNotesQuery(query))));
  }

  async create(draft: NoteDraft): Promise<Note> {
    return toNote(unwrap('create_note', await commands.createNote(toWireNoteDraft(draft))));
  }

  async update(id: string, patch: NotePatch): Promise<Note> {
    return toNote(unwrap('update_note', await commands.updateNote(id, toWireNotePatch(patch))));
  }

  /** Moves to the trash: the note is recoverable for 30 days. */
  async delete(id: string): Promise<void> {
    unwrap('delete_note', await commands.deleteNote(id));
  }

  async deleteMany(ids: readonly string[]): Promise<number> {
    return unwrap('delete_notes', await commands.deleteNotes([...ids]));
  }

  async restore(ids: readonly string[]): Promise<number> {
    return unwrap('restore_notes', await commands.restoreNotes([...ids]));
  }

  async loadTrash(): Promise<readonly TrashedNote[]> {
    return unwrap('list_trash', await commands.listTrash()).map(toTrashedNote);
  }

  async purge(ids: readonly string[]): Promise<number> {
    return unwrap('purge_notes', await commands.purgeNotes([...ids]));
  }

  async emptyTrash(): Promise<number> {
    return unwrap('empty_trash', await commands.emptyTrash());
  }

  async moveMany(ids: readonly string[], spaceId: string): Promise<number> {
    return unwrap('move_notes', await commands.moveNotes([...ids], spaceId));
  }

  async tagMany(ids: readonly string[], tags: readonly string[]): Promise<number> {
    return unwrap('tag_notes', await commands.tagNotes([...ids], [...tags]));
  }

  async loadTags(): Promise<readonly TagUsage[]> {
    return unwrap('list_tags', await commands.listTags());
  }

  async renameTag(tag: string, into: string): Promise<number> {
    return unwrap('rename_tag', await commands.renameTag(tag, into));
  }

  async mergeTags(tags: readonly string[], into: string): Promise<number> {
    return unwrap('merge_tags', await commands.mergeTags([...tags], into));
  }

  async deleteTags(tags: readonly string[]): Promise<number> {
    return unwrap('delete_tags', await commands.deleteTags([...tags]));
  }

  /**
   * Returns the note as persisted: `updatedAt` is **unchanged** there, filling a field
   * not being editing the note.
   */
  async setPlaceholderValues(id: string, values: Record<string, string>): Promise<Note> {
    return toNote(unwrap('set_placeholder_values', await commands.setPlaceholderValues(id, values)));
  }

  /**
   * **Global variables included**: a field left empty falls back to the variable before
   * the default written in the text. Hence the database read, and hence the `Result`.
   */
  async fillPlaceholders(content: string, values: Record<string, string>): Promise<string> {
    return unwrap('fill_placeholders', await commands.fillPlaceholders(content, values));
  }

  async loadVariables(): Promise<Record<string, string>> {
    return unwrap('list_global_placeholders', await commands.listGlobalPlaceholders());
  }

  /**
   * Stores the **whole** set: what is not sent is what the user removed. An empty value
   * is not stored — it means "I keep what the snippet offers".
   */
  async saveVariables(values: Record<string, string>): Promise<Record<string, string>> {
    return unwrap('set_global_placeholders', await commands.setGlobalPlaceholders(values));
  }
}
