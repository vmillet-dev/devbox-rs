import { FALLBACK_LANGUAGE, LanguageTag, isLanguageTag } from '@core/language/language.model';
import {
  Note,
  NoteDraft,
  NoteFilter,
  NoteFooter,
  NoteLifecycle,
  NotePatch,
  NoteSection,
  NoteSectionKey,
  NotesQuery,
  NotesView,
} from '../model/note.model';

/**
 * Représentation transportée sur le pont Tauri. Elle diffère du modèle sur un
 * point décisif : **JSON n'a pas de type date**, donc toute `Date` arrive et
 * repart en chaîne ISO 8601.
 *
 * ⚠️ Côté Rust les structs correspondantes portent
 * `#[serde(rename_all = "camelCase")]` (sinon on reçoit `created_at`) et les
 * enums à données `#[serde(tag = "kind", …)]` (sinon serde produit
 * `{"Expires":{…}}`, que le discriminant TS ne reconnaît pas). Ces attributs
 * sont figés par des tests dans `src-tauri/src/domain/`.
 *
 * `footer` et `expiringSoon` sont aplatis dans le même objet : un seul type de
 * note côté front.
 */
export interface NoteDto {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly language: string;
  readonly content: string;
  readonly source: string;
  readonly tags: readonly string[];
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lifecycle: NoteLifecycleDto;
  readonly footer: NoteFooterDto;
  readonly expiringSoon: boolean;
}

type NoteLifecycleDto = { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: string };

type NoteFooterDto =
  | { readonly kind: 'source'; readonly value: string }
  | { readonly kind: 'expiry'; readonly at: string }
  | { readonly kind: 'age'; readonly at: string };

export type NoteDraftDto = Omit<NoteDto, 'id' | 'createdAt' | 'updatedAt' | 'footer' | 'expiringSoon'>;
export type NotePatchDto = Partial<NoteDraftDto>;

export interface NotesQueryDto {
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  readonly tags: readonly string[];
  readonly languages: readonly string[];
  readonly now: string;
  readonly tzOffsetMinutes: number;
}

export interface NotesViewDto {
  readonly sections: readonly NoteSectionDto[];
  readonly availableTags: readonly string[];
  readonly availableLanguages: readonly string[];
  readonly isFiltering: boolean;
  readonly matched: number;
}

interface NoteSectionDto {
  readonly key: string;
  readonly notes: readonly NoteDto[];
  readonly hasExpiringNotes: boolean;
  readonly showCreateGhost: boolean;
}

/** Rupture de contrat entre ce que le pont livre et ce que le front sait lire. */
export class ContractError extends Error {
  constructor(field: string, value: unknown) {
    super(`Contrat rompu : champ « ${field} » inexploitable (${JSON.stringify(value)})`);
    this.name = 'ContractError';
  }
}

function parseIsoDate(value: string, field: string): Date {
  const date = new Date(value);
  // Échouer bruyamment plutôt que de laisser une `Invalid Date` ressortir en
  // `NaN` dans les libellés de temps relatif.
  if (Number.isNaN(date.getTime())) {
    throw new ContractError(field, value);
  }
  return date;
}

/**
 * Même exigence dans l'autre sens : `toISOString()` lève un `RangeError` nu sur
 * une `Invalid Date`, sans dire quel champ est en cause.
 */
export function toIsoString(date: Date, field: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new ContractError(field, date);
  }
  return date.toISOString();
}

function toLifecycle(dto: NoteLifecycleDto): NoteLifecycle {
  return dto.kind === 'expires'
    ? { kind: 'expires', at: parseIsoDate(dto.at, 'lifecycle.at') }
    : { kind: 'permanent' };
}

function toLifecycleDto(lifecycle: NoteLifecycle): NoteLifecycleDto {
  return lifecycle.kind === 'expires'
    ? { kind: 'expires', at: toIsoString(lifecycle.at, 'lifecycle.at') }
    : { kind: 'permanent' };
}

function toFooter(dto: NoteFooterDto): NoteFooter {
  if (dto.kind === 'source') return { kind: 'source', value: dto.value };
  if (dto.kind === 'expiry') return { kind: 'expiry', at: parseIsoDate(dto.at, 'footer.at') };
  if (dto.kind === 'age') return { kind: 'age', at: parseIsoDate(dto.at, 'footer.at') };
  // Variante ajoutée côté Rust sans être répercutée ici : mieux vaut le dire que
  // rendre un pied de carte vide.
  throw new ContractError('footer.kind', (dto satisfies never as { kind: string }).kind);
}

export function toNote(dto: NoteDto): Note {
  return {
    id: dto.id,
    spaceId: dto.spaceId,
    title: dto.title,
    // Un langage inconnu dégrade l'affichage, il ne casse pas le chargement.
    language: isLanguageTag(dto.language) ? dto.language : FALLBACK_LANGUAGE,
    content: dto.content,
    source: dto.source,
    tags: [...dto.tags],
    pinned: dto.pinned,
    createdAt: parseIsoDate(dto.createdAt, 'createdAt'),
    updatedAt: parseIsoDate(dto.updatedAt, 'updatedAt'),
    lifecycle: toLifecycle(dto.lifecycle),
    footer: toFooter(dto.footer),
    expiringSoon: dto.expiringSoon,
  };
}

export function toNoteDraftDto(draft: NoteDraft): NoteDraftDto {
  return {
    spaceId: draft.spaceId,
    title: draft.title,
    language: draft.language,
    content: draft.content,
    source: draft.source,
    tags: [...draft.tags],
    pinned: draft.pinned,
    lifecycle: toLifecycleDto(draft.lifecycle),
  };
}

export function toNotePatchDto(patch: NotePatch): NotePatchDto {
  const dto: Record<string, unknown> = {};
  // Recopie champ par champ : un `undefined` sérialisé deviendrait `null` côté
  // serde et écraserait la valeur existante au lieu de la laisser intacte.
  if (patch.spaceId !== undefined) dto['spaceId'] = patch.spaceId;
  if (patch.title !== undefined) dto['title'] = patch.title;
  if (patch.language !== undefined) dto['language'] = patch.language;
  if (patch.content !== undefined) dto['content'] = patch.content;
  if (patch.source !== undefined) dto['source'] = patch.source;
  if (patch.tags !== undefined) dto['tags'] = [...patch.tags];
  if (patch.pinned !== undefined) dto['pinned'] = patch.pinned;
  if (patch.lifecycle !== undefined) dto['lifecycle'] = toLifecycleDto(patch.lifecycle);
  return dto as NotePatchDto;
}

const SECTION_KEYS: readonly NoteSectionKey[] = ['pinned', 'today', 'week', 'older', 'results'];

function isSectionKey(value: string): value is NoteSectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value);
}

export function toNotesQueryDto(query: NotesQuery): NotesQueryDto {
  return {
    spaceId: query.spaceId,
    search: query.search,
    filter: query.filter,
    tags: [...query.tags],
    languages: [...query.languages],
    now: toIsoString(query.now, 'now'),
    tzOffsetMinutes: query.tzOffsetMinutes,
  };
}

function toSection(dto: NoteSectionDto): NoteSection {
  // Une clé inconnue n'a pas de traduction : elle produirait une section au
  // titre vide plutôt qu'une erreur visible.
  if (!isSectionKey(dto.key)) {
    throw new ContractError('section.key', dto.key);
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
    // Une facette inconnue est écartée là où une section inconnue fait échouer :
    // un rail auquel il manque un choix reste utilisable, un canevas dont une
    // section est illisible ne l'est pas.
    availableLanguages: dto.availableLanguages.filter((language): language is LanguageTag =>
      isLanguageTag(language),
    ),
    isFiltering: dto.isFiltering,
    matched: dto.matched,
  };
}
