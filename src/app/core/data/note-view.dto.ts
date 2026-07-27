import { NoteSection, NoteSectionKey } from '../models/note-section.model';
import { NoteFilter, NotesQuery, NotesView } from '../models/notes-query.model';
import { NoteDto, toIsoString, toNote } from './note.dto';

/**
 * Représentation de la vue sur le pont Tauri. Même contrainte que `note.dto.ts` :
 * JSON n'a pas de type date, donc `now` part en chaîne ISO.
 *
 * Côté Rust, `NotesQuery` / `NotesView` portent `#[serde(rename_all = "camelCase")]`
 * (voir `src-tauri/src/domain/query.rs`) — sans quoi le front recevrait
 * `available_tags` là où il lit `availableTags`.
 */
export interface NotesQueryDto {
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  readonly now: string;
  readonly tzOffsetMinutes: number;
}

export interface NotesViewDto {
  readonly sections: readonly NoteSectionDto[];
  readonly availableTags: readonly string[];
  readonly isFiltering: boolean;
  readonly matched: number;
}

export interface NoteSectionDto {
  readonly key: string;
  readonly notes: readonly NoteDto[];
  readonly hasExpiringNotes: boolean;
  readonly showCreateGhost: boolean;
}

const SECTION_KEYS: readonly NoteSectionKey[] = ['pinned', 'today', 'week', 'older', 'results'];

function isSectionKey(value: string): value is NoteSectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value);
}

/** Rupture de contrat entre la vue reçue et ce que le front sait afficher. */
export class NotesViewContractError extends Error {
  constructor(key: string) {
    super(`Vue reçue invalide : section « ${key} » inconnue`);
    this.name = 'NotesViewContractError';
  }
}

export function toNotesQueryDto(query: NotesQuery): NotesQueryDto {
  return {
    spaceId: query.spaceId,
    search: query.search,
    filter: query.filter,
    tags: [...query.tags],
    now: toIsoString(query.now, 'now'),
    tzOffsetMinutes: query.tzOffsetMinutes,
  };
}

function toSection(dto: NoteSectionDto): NoteSection {
  // Une clé inconnue n'a pas de traduction : elle produirait une section au
  // titre vide plutôt qu'une erreur visible. Mieux vaut échouer franchement.
  if (!isSectionKey(dto.key)) {
    throw new NotesViewContractError(dto.key);
  }

  return {
    key: dto.key,
    notes: dto.notes.map(toNote),
    hasExpiringNotes: dto.hasExpiringNotes,
    showCreateGhost: dto.showCreateGhost,
  };
}

export function toNotesView(dto: NotesViewDto): NotesView {
  return {
    sections: dto.sections.map(toSection),
    availableTags: [...dto.availableTags],
    isFiltering: dto.isFiltering,
    matched: dto.matched,
  };
}
