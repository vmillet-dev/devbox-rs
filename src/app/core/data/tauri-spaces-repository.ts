import { Injectable, inject } from '@angular/core';
import { IpcService } from '../ipc/ipc.service';
import { Space, SpaceDraft } from '../models/space.model';
import { SpaceDto, toSpace, toSpaceDraftDto } from './space.dto';
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
    const dtos = await this.ipc.invoke<SpaceDto[]>('list_spaces');
    return dtos.map(toSpace);
  }

  async create(draft: SpaceDraft): Promise<Space> {
    const dto = await this.ipc.invoke<SpaceDto>('create_space', { draft: toSpaceDraftDto(draft) });
    return toSpace(dto);
  }
}
