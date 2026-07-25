import { FALLBACK_LANGUAGE, isLanguageTag } from '../models/language.model';
import { Note, NoteDraft, NoteLifecycle, NotePatch } from '../models/note.model';

/**
 * Représentation transportée sur le pont Tauri. Elle diffère du modèle métier
 * sur un point décisif : **JSON n'a pas de type date**, donc tout ce qui est
 * `Date` côté Angular arrive et repart en chaîne ISO 8601.
 *
 * Côté Rust, la struct correspondante doit porter
 * `#[serde(rename_all = "camelCase")]` (sinon on reçoit `created_at`) et
 * l'enum de cycle de vie `#[serde(tag = "kind", rename_all = "camelCase")]`
 * (sinon serde produit `{"Expires":{…}}`, que le discriminant TS ne reconnaît pas).
 * Voir les TODO de `src-tauri/src/commands/notes.rs`.
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
}

export type NoteLifecycleDto =
  { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: string };

export type NoteDraftDto = Omit<NoteDto, 'id' | 'createdAt' | 'updatedAt'>;
export type NotePatchDto = Partial<NoteDraftDto>;

/** Rupture de contrat entre le DTO reçu et ce que le front sait interpréter. */
export class NoteContractError extends Error {
  constructor(field: string, value: unknown) {
    super(`Note reçue invalide : champ « ${field} » inexploitable (${JSON.stringify(value)})`);
    this.name = 'NoteContractError';
  }
}

function parseIsoDate(value: string, field: string): Date {
  const date = new Date(value);
  // Échouer bruyamment ici plutôt que de laisser une `Invalid Date` se propager
  // et ressortir en `NaN` dans les libellés de temps relatif.
  if (Number.isNaN(date.getTime())) {
    throw new NoteContractError(field, value);
  }
  return date;
}

function toLifecycle(dto: NoteLifecycleDto): NoteLifecycle {
  return dto.kind === 'expires'
    ? { kind: 'expires', at: parseIsoDate(dto.at, 'lifecycle.at') }
    : { kind: 'permanent' };
}

function toLifecycleDto(lifecycle: NoteLifecycle): NoteLifecycleDto {
  return lifecycle.kind === 'expires'
    ? { kind: 'expires', at: lifecycle.at.toISOString() }
    : { kind: 'permanent' };
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
