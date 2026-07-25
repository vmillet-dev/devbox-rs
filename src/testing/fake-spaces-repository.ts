import { SpacesRepository } from '@core/data/spaces-repository.token';
import { Space } from '@core/models/space.model';

/** In-memory `SpacesRepository` test double. */
export class FakeSpacesRepository implements SpacesRepository {
  constructor(private readonly spaces: readonly Space[] = []) {}

  loadAll(): Promise<readonly Space[]> {
    return Promise.resolve(this.spaces);
  }
}
