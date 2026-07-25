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
 * Les commandes (`query_notes`, `create_note`, `update_note`, `delete_note`,
 * `list_spaces`, `create_space`) sont enregistrées dans `src-tauri/src/lib.rs`.
 * Le contrat de sérialisation à respecter est détaillé dans
 * `src-tauri/src/commands/notes.rs`, `src/app/core/data/note.dto.ts` et
 * `src/app/core/data/note-view.dto.ts`.
 */
export function provideDataAccess(): Provider[] {
  return [
    { provide: NOTES_REPOSITORY, useClass: TauriNotesRepository },
    { provide: SPACES_REPOSITORY, useClass: TauriSpacesRepository },
  ];
}
