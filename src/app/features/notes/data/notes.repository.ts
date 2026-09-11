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

  /** Met à la corbeille : la note est récupérable pendant 30 jours. */
  async delete(id: string): Promise<void> {
    unwrap('delete_note', await commands.deleteNote(id));
  }

  /** Renvoie le nombre de notes réellement mises à la corbeille. */
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

  /** Ajoute sans remplacer : une action de masse enrichit l'étiquetage. */
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

  async deleteTag(tag: string): Promise<number> {
    return unwrap('delete_tag', await commands.deleteTag(tag));
  }

  /**
   * Enregistre ce qui a été saisi dans les `{{champs}}` d'une note. Renvoie la
   * note telle que persistée : `updatedAt` y est **inchangé**, remplir un champ
   * n'étant pas modifier la note.
   */
  async setPlaceholderValues(id: string, values: Record<string, string>): Promise<Note> {
    return toNote(unwrap('set_placeholder_values', await commands.setPlaceholderValues(id, values)));
  }

  /**
   * Remplit les `{{champs}}` d'un contenu, **variables globales comprises** :
   * un champ laissé vide retombe sur la variable avant de retomber sur la
   * valeur par défaut du texte. D'où la lecture en base, et donc le `Result`.
   */
  async fillPlaceholders(content: string, values: Record<string, string>): Promise<string> {
    return unwrap('fill_placeholders', await commands.fillPlaceholders(content, values));
  }

  /** Les variables globales, telles que le panneau de préférences les édite. */
  async loadVariables(): Promise<Record<string, string>> {
    return unwrap('list_global_placeholders', await commands.listGlobalPlaceholders());
  }

  /**
   * Enregistre le **jeu complet** : ce qui n'est pas envoyé est ce que
   * l'utilisateur a retiré. Renvoie ce qui a été retenu — une valeur vide n'est
   * pas stockée, elle veut dire « je garde ce que le snippet propose ».
   */
  async saveVariables(values: Record<string, string>): Promise<Record<string, string>> {
    return unwrap('set_global_placeholders', await commands.setGlobalPlaceholders(values));
  }
}
