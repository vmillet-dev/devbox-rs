import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import type { Space as WireSpace } from '@core/ipc/bindings';
import { Space, SpaceDraft } from '../model/space.model';

/**
 * ⚠️ The one thing a space needs converting for.  carries  * so an export file written before the column stays readable, and specta turns that
 * into an **optional** key — which the model refuses to be. Settled once, here, rather
 * than in every component that reads it.
 */
function toSpace(dto: WireSpace): Space {
  return { id: dto.id, name: dto.name, pinned: dto.pinned ?? false };
}

/**
 * ⚠️ `delete` takes a **refuge** space: the schema takes a deleted space's notes with it
 * (`ON DELETE CASCADE`), so a one-argument signature would have made data loss the
 * default. The transfer and the deletion are atomic on the Rust side.
 */
@Injectable({ providedIn: 'root' })
export class SpacesRepository {
  async loadAll(): Promise<readonly Space[]> {
    return unwrap('list_spaces', await commands.listSpaces()).map(toSpace);
  }

  async create(draft: SpaceDraft): Promise<Space> {
    return toSpace(unwrap('create_space', await commands.createSpace(draft)));
  }

  async rename(id: string, draft: SpaceDraft): Promise<Space> {
    return toSpace(unwrap('rename_space', await commands.renameSpace(id, draft)));
  }

  /** Hoists it to the head of the list, or lets it fall back among the others. */
  async setPinned(id: string, pinned: boolean): Promise<Space> {
    return toSpace(unwrap('pin_space', await commands.pinSpace(id, pinned)));
  }

  /** `targetSpaceId` receives the deleted space's notes. */
  async delete(id: string, targetSpaceId: string): Promise<void> {
    unwrap('delete_space', await commands.deleteSpace(id, targetSpaceId));
  }
}
