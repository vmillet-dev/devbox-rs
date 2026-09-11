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
  toNoteDraftDto,
  toNotePatchDto,
  toNotesQueryDto,
  toNotesView,
  toTrashedNote,
} from './note.dto';

/**
 * The way in to the notes: no component or store touches a data source
 * otherwise. The signatures come from `bindings.ts`, generated from the Rust —
 * a misnamed argument or a type that moved is a build error.
 *
 * `query` returns a view **already filtered and grouped**; there is deliberately
 * no method handing back the raw list, so no caller is tempted to re-filter.
 * `create` and `update` return the note **as persisted**.
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

  /** Moves to the trash: the note is recoverable for 30 days. */
  async delete(id: string): Promise<void> {
    unwrap('delete_note', await commands.deleteNote(id));
  }

  /** The number of notes actually trashed. */
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

  /** Adds without replacing: a bulk action enriches the labelling. */
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

  /** Removes a whole selection in one round trip. */
  async deleteTags(tags: readonly string[]): Promise<number> {
    return unwrap('delete_tags', await commands.deleteTags([...tags]));
  }

  /**
   * Stores what was typed into a note's `{{fields}}`. Returns the note as
   * persisted: `updatedAt` is **unchanged** there, filling a field not being
   * editing the note.
   */
  async setPlaceholderValues(id: string, values: Record<string, string>): Promise<Note> {
    return toNote(unwrap('set_placeholder_values', await commands.setPlaceholderValues(id, values)));
  }

  /**
   * Fills a content's `{{fields}}`, **global variables included**: a field left
   * empty falls back to the variable before falling back to the default written
   * in the text. Hence the database read, and hence the `Result`.
   */
  async fillPlaceholders(content: string, values: Record<string, string>): Promise<string> {
    return unwrap('fill_placeholders', await commands.fillPlaceholders(content, values));
  }

  /** The global variables, as the preferences panel edits them. */
  async loadVariables(): Promise<Record<string, string>> {
    return unwrap('list_global_placeholders', await commands.listGlobalPlaceholders());
  }

  /**
   * Stores the **whole** set: what is not sent is what the user removed.
   * Returns what was kept — an empty value is not stored, it means "I keep what
   * the snippet offers".
   */
  async saveVariables(values: Record<string, string>): Promise<Record<string, string>> {
    return unwrap('set_global_placeholders', await commands.setGlobalPlaceholders(values));
  }
}
