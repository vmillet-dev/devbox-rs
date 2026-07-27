import { FALLBACK_LANGUAGE, isLanguageTag } from '../models/language.model';
import { Note, NoteDraft, NoteFooter, NoteLifecycle, NotePatch } from '../models/note.model';

/**
 * Représentation transportée sur le pont Tauri. Elle diffère du modèle métier
 * sur un point décisif : **JSON n'a pas de type date**, donc tout ce qui est
 * `Date` côté Angular arrive et repart en chaîne ISO 8601.
 *
 * Côté Rust, la struct correspondante doit porter
 * `#[serde(rename_all = "camelCase")]` (sinon on reçoit `created_at`) et
 * l'enum de cycle de vie `#[serde(tag = "kind", rename_all = "camelCase")]`
 * (sinon serde produit `{"Expires":{…}}`, que le discriminant TS ne reconnaît pas).
 * Voir `src-tauri/src/domain/note.rs`, où ces attributs sont figés par des tests.
 *
 * `footer` et `expiringSoon` viennent de `domain::display` et sont aplatis dans
 * le même objet (`#[serde(flatten)]`) : le front n'a qu'un type de note.
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

export type NoteLifecycleDto =
  { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: string };

export type NoteFooterDto =
  | { readonly kind: 'source'; readonly value: string }
  | { readonly kind: 'expiry'; readonly at: string }
  | { readonly kind: 'age'; readonly at: string };

export type NoteDraftDto = Omit<NoteDto, 'id' | 'createdAt' | 'updatedAt' | 'footer' | 'expiringSoon'>;
export type NotePatchDto = Partial<NoteDraftDto>;

/** Rupture de contrat entre un DTO et ce que le front sait interpréter. */
export class NoteContractError extends Error {
  constructor(field: string, value: unknown) {
    super(`Contrat de note rompu : champ « ${field} » inexploitable (${JSON.stringify(value)})`);
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

/**
 * Même exigence dans l'autre sens : `toISOString()` lève un `RangeError` nu sur
 * une `Invalid Date`, sans dire quel champ est en cause. Le chemin d'écriture
 * mérite le même diagnostic que le chemin de lecture.
 */
export function toIsoString(date: Date, field: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new NoteContractError(field, date);
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
  // Une variante ajoutée côté Rust sans être répercutée ici : mieux vaut le dire
  // que rendre un pied de carte vide.
  throw new NoteContractError('footer.kind', (dto satisfies never as { kind: string }).kind);
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
