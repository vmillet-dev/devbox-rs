import type {
  Attachment as WireAttachment,
  DisplayNote,
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
 * The shape carried over the Tauri bridge, **generated** from the Rust structs by
 * tauri-specta. What generation cannot cover, and what this file exists for: **JSON
 * has no date type**, so every `Date` arrives and leaves as an ISO 8601 string. The
 * conversions below spread the wire object and override only the dates, so a scalar
 * added on the Rust side costs nothing here.
 */
export type NoteDto = DisplayNote;

export type NoteDraftDto = WireNoteDraft;
export type NotePatchDto = WireNotePatch;
export type NotesQueryDto = WireNotesQuery;
export type NotesViewDto = WireNotesView;

/** A break between what the bridge delivers and what the front can read. */
export class ContractError extends Error {
  constructor(field: string, value: unknown) {
    super(`Broken contract: field "${field}" is unusable (${JSON.stringify(value)})`);
    this.name = 'ContractError';
  }
}

function parseIsoDate(value: string, field: string): Date {
  const date = new Date(value);
  // Fail loudly rather than let an `Invalid Date` surface as `NaN` in the labels.
  if (Number.isNaN(date.getTime())) {
    throw new ContractError(field, value);
  }
  return date;
}

/**
 * `toISOString()` throws a bare `RangeError` on an `Invalid Date`, without saying which
 * field is at fault.
 */
export function toIsoString(date: Date, field: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new ContractError(field, date);
  }
  return date.toISOString();
}

/** Drops the keys a patch does not carry, which serde reads as "do not touch". */
function withoutUndefined<T extends object>(source: T): T {
  const kept = {} as T;

  for (const key of Object.keys(source) as (keyof T)[]) {
    const value = source[key];
    if (value !== undefined) {
      kept[key] = value;
    }
  }

  return kept;
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
  switch (dto.kind) {
    case 'source':
      return { kind: 'source', value: dto.value };
    case 'expiry':
      return { kind: 'expiry', at: parseIsoDate(dto.at, 'footer.at') };
    case 'age':
      return { kind: 'age', at: parseIsoDate(dto.at, 'footer.at') };
    default:
      // Only fires when an older front end meets a newer back end — the switch is
      // exhaustive at compile time — and saying so beats a blank footer.
      throw new ContractError('footer.kind', (dto satisfies never as { kind: string }).kind);
  }
}

/**
 * ⚠️ `placeholderValues` is dropped on purpose: the front end reads what was typed
 * through `placeholders[].value`, already paired with the field the text carries. A
 * second, unpaired copy would invite reading a value whose token has left the content.
 *
 * The arrays are aliased rather than copied: this runs for every note of every view on
 * every keystroke, and the model types are `readonly`.
 */
export function toNote({ placeholderValues: _stored, ...dto }: NoteDto): Note {
  return {
    ...dto,
    createdAt: parseIsoDate(dto.createdAt, 'createdAt'),
    updatedAt: parseIsoDate(dto.updatedAt, 'updatedAt'),
    lifecycle: toLifecycle(dto.lifecycle),
    footer: toFooter(dto.footer),
    // Declared optional by `#[serde(default)]`, which keeps older export files readable.
    kind: dto.kind ?? 'snippet',
    items: dto.items ?? [],
  };
}

/**
 * Narrower than a `Note` on purpose: a trashed note is restored or purged, never
 * opened, so nothing decorated travels this far.
 */
export function toTrashedNote(dto: WireTrashedNote): TrashedNote {
  return {
    id: dto.id,
    spaceId: dto.spaceId,
    title: dto.title,
    language: dto.language,
    content: dto.content,
    // Copied here, unlike `toNote`: the panel opens on demand over a handful of rows.
    tags: [...dto.tags],
    deletedAt: parseIsoDate(dto.deletedAt, 'deletedAt'),
    purgeAt: parseIsoDate(dto.purgeAt, 'purgeAt'),
    kind: dto.kind ?? 'snippet',
  };
}

export function toAttachment(dto: WireAttachment): Attachment {
  return { ...dto, createdAt: parseIsoDate(dto.createdAt, 'createdAt') };
}

/** The wire draft wants mutable arrays; the model holds `readonly` ones. */
export function toNoteDraftDto(draft: NoteDraft): NoteDraftDto {
  return {
    ...draft,
    tags: [...draft.tags],
    items: [...draft.items],
    lifecycle: toLifecycleDto(draft.lifecycle),
  };
}

/**
 * A key left out is a field the patch does not touch; a key sent as `null` would
 * overwrite it — hence the filtering, and hence `#[specta(optional)]` on the Rust side.
 */
export function toNotePatchDto(patch: NotePatch): NotePatchDto {
  const { lifecycle, tags, items, ...scalars } = patch;
  const dto: NotePatchDto = withoutUndefined(scalars);

  if (lifecycle !== undefined) dto.lifecycle = toLifecycleDto(lifecycle);
  if (tags !== undefined) dto.tags = [...tags];
  // Copied item by item: a patch is the last thing to hold these objects.
  if (items !== undefined) dto.items = items.map((item) => ({ ...item }));

  return dto;
}

export function toNotesQueryDto(query: NotesQuery): NotesQueryDto {
  return {
    ...query,
    tags: [...query.tags],
    languages: [...query.languages],
    now: toIsoString(query.now, 'now'),
  };
}

function toSection(dto: WireNoteSection): NoteSection {
  return { ...dto, notes: dto.notes.map(toNote) };
}

export function toNotesView(dto: NotesViewDto): NotesView {
  return { ...dto, sections: dto.sections.map(toSection) };
}
