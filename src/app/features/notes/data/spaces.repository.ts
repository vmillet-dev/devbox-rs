import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import { Space, SpaceDraft } from '../model/space.model';

/**
 * The way in to the spaces: no component or store touches a data source
 * otherwise.
 *
 * `create` and `rename` return the space **as persisted** — persistence assigns
 * the `id`.
 *
 * ⚠️ `delete` takes a **refuge** space: the schema takes a deleted space's
 * notes with it (`ON DELETE CASCADE`), so a one-argument signature would have
 * made data loss the default. The transfer and the deletion are atomic on the
 * Rust side.
 */
@Injectable({ providedIn: 'root' })
export class SpacesRepository {
  async loadAll(): Promise<readonly Space[]> {
    return unwrap('list_spaces', await commands.listSpaces());
  }

  async create(draft: SpaceDraft): Promise<Space> {
    return unwrap('create_space', await commands.createSpace(draft));
  }

  async rename(id: string, draft: SpaceDraft): Promise<Space> {
    return unwrap('rename_space', await commands.renameSpace(id, draft));
  }

  /** `targetSpaceId` receives the deleted space's notes. */
  async delete(id: string, targetSpaceId: string): Promise<void> {
    unwrap('delete_space', await commands.deleteSpace(id, targetSpaceId));
  }
}
