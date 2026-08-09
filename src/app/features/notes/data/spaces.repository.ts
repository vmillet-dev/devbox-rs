import { Injectable } from '@angular/core';
import { commands } from '@core/ipc/bindings';
import { unwrap } from '@core/ipc/ipc.error';
import { Space, SpaceDraft } from '../model/space.model';

/**
 * Point d'accès aux espaces : ni composant ni store ne touche une source de
 * données autrement.
 *
 * `create` et `rename` renvoient l'espace **tel que persisté** — c'est la
 * persistance qui attribue l'`id`. `delete` prend un espace **refuge** : le
 * schéma emporte les notes d'un espace supprimé (`ON DELETE CASCADE`), donc une
 * signature à un argument aurait fait de la perte de données le défaut. Le
 * transfert et la suppression sont atomiques côté Rust.
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

  /** `targetSpaceId` recueille les notes de l'espace supprimé. */
  async delete(id: string, targetSpaceId: string): Promise<void> {
    unwrap('delete_space', await commands.deleteSpace(id, targetSpaceId));
  }
}
