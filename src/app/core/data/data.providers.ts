import { Provider } from '@angular/core';
import { MockNotesRepository } from './mock-notes-repository';
import { MockSpacesRepository } from './mock-spaces-repository';
import { NOTES_REPOSITORY } from './notes-repository.token';
import { SPACES_REPOSITORY } from './spaces-repository.token';

/**
 * Choix de la source de données de l'application — **le seul endroit à modifier**
 * pour passer des mocks au backend Rust :
 *
 * ```ts
 * import { TauriNotesRepository } from './tauri-notes-repository';
 * import { TauriSpacesRepository } from './tauri-spaces-repository';
 *
 * { provide: NOTES_REPOSITORY, useClass: TauriNotesRepository },
 * { provide: SPACES_REPOSITORY, useClass: TauriSpacesRepository },
 * ```
 *
 * Prérequis côté Rust avant la bascule : les commandes `list_notes`,
 * `create_note`, `update_note`, `delete_note` et `list_spaces` doivent exister
 * **et** être enregistrées dans `generate_handler![...]` (`src-tauri/src/lib.rs`),
 * avec le contrat serde décrit dans `note.dto.ts`.
 */
export function provideDataAccess(): Provider[] {
  return [
    { provide: NOTES_REPOSITORY, useClass: MockNotesRepository },
    { provide: SPACES_REPOSITORY, useClass: MockSpacesRepository },
  ];
}
