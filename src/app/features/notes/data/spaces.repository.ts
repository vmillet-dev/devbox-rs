import { Injectable, inject } from '@angular/core';
import { IpcService } from '@core/ipc/ipc.service';
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
  private readonly ipc = inject(IpcService);

  async loadAll(): Promise<readonly Space[]> {
    return this.ipc.invoke('list_spaces');
  }

  async create(draft: SpaceDraft): Promise<Space> {
    return this.ipc.invoke('create_space', { draft });
  }

  async rename(id: string, draft: SpaceDraft): Promise<Space> {
    return this.ipc.invoke('rename_space', { id, draft });
  }

  /** `targetSpaceId` recueille les notes de l'espace supprimé. */
  async delete(id: string, targetSpaceId: string): Promise<void> {
    await this.ipc.invoke('delete_space', { id, targetSpaceId });
  }
}
