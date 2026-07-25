import { Injectable } from '@angular/core';
import { Space } from '../models/space.model';
import { SpacesRepository } from './spaces-repository.token';
import { MOCK_SPACES } from './spaces.mock-data';

/** Dépôt d'espaces en mémoire, en attendant la commande Rust `list_spaces`. */
@Injectable()
export class MockSpacesRepository implements SpacesRepository {
  loadAll(): Promise<readonly Space[]> {
    return Promise.resolve(MOCK_SPACES);
  }
}
