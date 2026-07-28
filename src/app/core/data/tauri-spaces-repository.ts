import { Injectable, inject } from '@angular/core';
import { IpcService } from '../ipc/ipc.service';
import { Space, SpaceDraft } from '../models/space.model';
import { toSpace, toSpaceDraftDto } from './space.dto';
import { SpacesRepository } from './spaces-repository.token';

/**
 * Dépôt d'espaces adossé aux commandes Rust `list_spaces` / `create_space`.
 * Même statut que `TauriNotesRepository` : c'est la source de données active de
 * l'application (voir `data.providers.ts`).
 */
@Injectable()
export class TauriSpacesRepository implements SpacesRepository {
  private readonly ipc = inject(IpcService);

  async loadAll(): Promise<readonly Space[]> {
    return (await this.ipc.invoke('list_spaces')).map(toSpace);
  }

  async create(draft: SpaceDraft): Promise<Space> {
    return toSpace(await this.ipc.invoke('create_space', { draft: toSpaceDraftDto(draft) }));
  }

  async rename(id: string, draft: SpaceDraft): Promise<Space> {
    return toSpace(await this.ipc.invoke('rename_space', { id, draft: toSpaceDraftDto(draft) }));
  }

  async delete(id: string, targetSpaceId: string): Promise<void> {
    await this.ipc.invoke('delete_space', { id, targetSpaceId });
  }
}
