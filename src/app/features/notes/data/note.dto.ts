import type {
  Attachment as WireAttachment,
  DisplayNote,
  ImportReport as WireImportReport,
  NoteDraft as WireNoteDraft,
  NoteFooter as WireNoteFooter,
  NoteLifecycle as WireNoteLifecycle,
  NotePatch as WireNotePatch,
  NoteSection as WireNoteSection,
  NotesQuery as WireNotesQuery,
  NotesView as WireNotesView,
  TrashedNote as WireTrashedNote,
} from '@core/ipc/bindings';
import {
  Attachment,
  ImportReport,
  Note,
  NoteDraft,
  NoteFooter,
  NoteLifecycle,
  NotePatch,
  NoteSection,
  NotesQuery,
  NotesView,
  TrashedNote,
} from '../model/note.model';

/**
 * Représentation transportée sur le pont Tauri, **générée** depuis les structs
 * Rust par tauri-specta (`@core/ipc/bindings`). Le reste de l'application ne lit
 * jamais `bindings.ts` : elle passe par ces alias, qui gardent le vocabulaire de
 * la frontière au même endroit que sa conversion.
 *
 * Ce qui subsiste malgré la génération, c'est ce que le générateur ne peut pas
 * savoir : **JSON n'a pas de type date**, donc toute `Date` arrive et repart en
 * chaîne ISO 8601. Le `language`, lui, ne demande plus rien : l'enum Rust en
 * fait une union générée que le front reçoit déjà restreinte.
 *
 * `footer` et `expiringSoon` sont aplatis dans le même objet (le `#[serde(flatten)]`
 * de `DisplayNote`) : un seul type de note côté front.
 */
export type NoteDto = DisplayNote;

export type NoteDraftDto = WireNoteDraft;
export type NotePatchDto = WireNotePatch;
export type NotesQueryDto = WireNotesQuery;
export type NotesViewDto = WireNotesView;

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

function toLifecycle(dto: WireNoteLifecycle): NoteLifecycle {
  return dto.kind === 'expires'
    ? { kind: 'expires', at: parseIsoDate(dto.at, 'lifecycle.at') }
    : { kind: 'permanent' };
}

function toLifecycleDto(lifecycle: NoteLifecycle): WireNoteLifecycle {
  return lifecycle.kind === 'expires'
    ? { kind: 'expires', at: toIsoString(lifecycle.at, 'lifecycle.at') }
    : { kind: 'permanent' };
}

function toFooter(dto: WireNoteFooter): NoteFooter {
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
    language: dto.language,
    content: dto.content,
    source: dto.source,
    tags: [...dto.tags],
    pinned: dto.pinned,
    createdAt: parseIsoDate(dto.createdAt, 'createdAt'),
    updatedAt: parseIsoDate(dto.updatedAt, 'updatedAt'),
    lifecycle: toLifecycle(dto.lifecycle),
    footer: toFooter(dto.footer),
    expiringSoon: dto.expiringSoon,
    placeholders: dto.placeholders.map((placeholder) => ({ ...placeholder })),
    attachmentCount: dto.attachmentCount,
  };
}

export function toTrashedNote(dto: WireTrashedNote): TrashedNote {
  return {
    id: dto.id,
    spaceId: dto.spaceId,
    title: dto.title,
    language: dto.language,
    content: dto.content,
    tags: [...dto.tags],
    deletedAt: parseIsoDate(dto.deletedAt, 'deletedAt'),
    purgeAt: parseIsoDate(dto.purgeAt, 'purgeAt'),
  };
}

export function toAttachment(dto: WireAttachment): Attachment {
  return {
    id: dto.id,
    noteId: dto.noteId,
    fileName: dto.fileName,
    mimeType: dto.mimeType,
    byteSize: dto.byteSize,
    createdAt: parseIsoDate(dto.createdAt, 'createdAt'),
  };
}

export function toImportReport(dto: WireImportReport): ImportReport {
  return {
    spacesCreated: dto.spacesCreated,
    notesImported: dto.notesImported,
    notesSkipped: dto.notesSkipped,
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
  const dto: NotePatchDto = {};
  // Recopie champ par champ : un `undefined` sérialisé deviendrait `null` côté
  // serde et écraserait la valeur existante au lieu de la laisser intacte. Le
  // `#[specta(optional)]` des champs Rust est ce qui rend ces clés omissibles.
  if (patch.spaceId !== undefined) dto.spaceId = patch.spaceId;
  if (patch.title !== undefined) dto.title = patch.title;
  if (patch.language !== undefined) dto.language = patch.language;
  if (patch.content !== undefined) dto.content = patch.content;
  if (patch.source !== undefined) dto.source = patch.source;
  if (patch.tags !== undefined) dto.tags = [...patch.tags];
  if (patch.pinned !== undefined) dto.pinned = patch.pinned;
  if (patch.lifecycle !== undefined) dto.lifecycle = toLifecycleDto(patch.lifecycle);
  return dto;
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

/**
 * Plus de garde sur `key` : `NoteSectionKey` vient des bindings, donc une
 * variante ajoutée côté Rust casse cette affectation à la compilation. La garde
 * d'exécution ne rattrapait que ce que le compilateur ignorait.
 */
function toSection(dto: WireNoteSection): NoteSection {
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
    availableLanguages: [...dto.availableLanguages],
    isFiltering: dto.isFiltering,
    matched: dto.matched,
  };
}
