import { Injectable, inject } from '@angular/core';
import { IpcService } from '../ipc/ipc.service';
import { Space } from '../models/space.model';
import { SpaceDto, toSpace } from './space.dto';
import { SpacesRepository } from './spaces-repository.token';

/**
 * Implémentation réelle du dépôt d'espaces. Même statut que
 * `TauriNotesRepository` : écrite, non activée, bascule dans `data.providers.ts`.
 */
@Injectable()
export class TauriSpacesRepository implements SpacesRepository {
  private readonly ipc = inject(IpcService);

  async loadAll(): Promise<readonly Space[]> {
    const dtos = await this.ipc.invoke<SpaceDto[]>('list_spaces');
    return dtos.map(toSpace);
  }
}
