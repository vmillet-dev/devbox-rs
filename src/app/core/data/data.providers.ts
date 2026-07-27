import { Provider } from '@angular/core';
import { NOTES_REPOSITORY } from './notes-repository.token';
import { SPACES_REPOSITORY } from './spaces-repository.token';
import { TauriNotesRepository } from './tauri-notes-repository';
import { TauriSpacesRepository } from './tauri-spaces-repository';

/**
 * Source de données de l'application : le backend Rust, via les dépôts `Tauri*`.
 * Il n'y a plus de jeu de données en mémoire — les seuls doubles restants sont
 * ceux des tests (`src/testing/`), injectés par `provideAppTesting`.
 *
 * Les commandes sont énumérées par `core/ipc/ipc-contract.ts` — qui type aussi
 * leurs arguments — et enregistrées dans `src-tauri/src/lib.rs`. Le contrat de
 * sérialisation est figé par les tests de `src-tauri/src/domain/note.rs` et
 * décrit côté front dans `note.dto.ts` / `note-view.dto.ts`.
 */
export function provideDataAccess(): Provider[] {
  return [
    { provide: NOTES_REPOSITORY, useClass: TauriNotesRepository },
    { provide: SPACES_REPOSITORY, useClass: TauriSpacesRepository },
  ];
}
