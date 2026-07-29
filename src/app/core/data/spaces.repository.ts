import { Injectable, InjectionToken, inject } from '@angular/core';
import { IpcService } from '../ipc/ipc.service';
import { Space, SpaceDraft } from '../models/space.model';

/**
 * Un espace n'a aucun champ à convertir : le DTO est structurellement identique
 * au modèle, d'où des alias plutôt que des mappeurs identité.
 */
export type SpaceDto = Space;
export type SpaceDraftDto = SpaceDraft;

/**
 * Point d'accès aux espaces. Aucun composant ne touche une source de données
 * directement : tout passe par ce jeton.
 *
 * `create` et `rename` renvoient l'espace **tel que persisté** — c'est la
 * persistance qui attribue l'`id`. `delete` prend un espace **refuge** : le
 * schéma emporte les notes d'un espace supprimé (`ON DELETE CASCADE`), donc une
 * signature à un argument aurait fait de la perte de données le défaut. Le
 * transfert et la suppression sont atomiques côté Rust.
 */
export interface SpacesRepository {
  loadAll(): Promise<readonly Space[]>;
  create(draft: SpaceDraft): Promise<Space>;
  rename(id: string, draft: SpaceDraft): Promise<Space>;
  /** `targetSpaceId` recueille les notes de l'espace supprimé. */
  delete(id: string, targetSpaceId: string): Promise<void>;
}

export const SPACES_REPOSITORY = new InjectionToken<SpacesRepository>('SPACES_REPOSITORY');

/** Implémentation active : les commandes Rust (voir `app.config.ts`). */
@Injectable()
export class TauriSpacesRepository implements SpacesRepository {
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

  async delete(id: string, targetSpaceId: string): Promise<void> {
    await this.ipc.invoke('delete_space', { id, targetSpaceId });
  }
}
