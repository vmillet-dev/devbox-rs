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
 * The shape carried over the Tauri bridge, **generated** from the Rust structs
 * by tauri-specta. The rest of the application never reads `bindings.ts`: it
 * goes through these aliases, which keep the boundary vocabulary next to its
 * conversion.
 *
 * What generation cannot cover, and what this file exists for: **JSON has no
 * date type**, so every `Date` arrives and leaves as an ISO 8601 string. Every
 * other field already has the right type, which is why the conversions below
 * spread the wire object and override only the dates — a scalar added on the
 * Rust side then costs nothing here.
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
  // Fail loudly rather than let an `Invalid Date` surface as `NaN` in the
  // relative-time labels.
  if (Number.isNaN(date.getTime())) {
    throw new ContractError(field, value);
  }
  return date;
}

/**
 * Same requirement the other way: `toISOString()` throws a bare `RangeError` on
 * an `Invalid Date`, without saying which field is at fault.
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
      // A variant added on the Rust side and not reflected here. The switch is
      // exhaustive at compile time, so this only fires when an older front
      // meets a newer back end — and saying so beats a blank footer.
      throw new ContractError('footer.kind', (dto satisfies never as { kind: string }).kind);
  }
}

/**
 * ⚠️ `placeholderValues` is dropped on purpose: the front reads what was typed
 * through `placeholders[].value`, where the back end has already paired it with
 * the field the text actually carries. A second, unpaired copy would invite
 * reading a value whose token has left the content.
 *
 * The arrays are aliased rather than copied. This runs for every note of every
 * view on every keystroke, the payload is a fresh `JSON.parse` nothing else
 * retains, and the model types are `readonly` — the copies bought nothing and
 * cost thousands of allocations per search.
 */
export function toNote({ placeholderValues: _stored, ...dto }: NoteDto): Note {
  return {
    ...dto,
    createdAt: parseIsoDate(dto.createdAt, 'createdAt'),
    updatedAt: parseIsoDate(dto.updatedAt, 'updatedAt'),
    lifecycle: toLifecycle(dto.lifecycle),
    footer: toFooter(dto.footer),
    // Declared optional by `#[serde(default)]`, which keeps export files written
    // before todo lists readable. Rust always serialises them.
    kind: dto.kind ?? 'snippet',
    items: dto.items ?? [],
  };
}

/**
 * Deliberately narrower than a `Note`: a trashed note is restored or purged,
 * never opened, so nothing decorated travels this far.
 */
export function toTrashedNote(dto: WireTrashedNote): TrashedNote {
  return {
    id: dto.id,
    spaceId: dto.spaceId,
    title: dto.title,
    language: dto.language,
    content: dto.content,
    // Copied here, unlike `toNote`: the trash panel opens on demand over a
    // handful of rows, so the allocation is free and the isolation is worth it.
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
 * A key left out is a field the patch does not touch; a key sent as `null`
 * would overwrite it. Hence the filtering rather than a plain spread — and
 * hence `#[specta(optional)]` on the Rust fields, which is what makes the keys
 * omissible at all.
 */
export function toNotePatchDto(patch: NotePatch): NotePatchDto {
  const { lifecycle, tags, items, ...scalars } = patch;
  const dto: NotePatchDto = withoutUndefined(scalars);

  if (lifecycle !== undefined) dto.lifecycle = toLifecycleDto(lifecycle);
  if (tags !== undefined) dto.tags = [...tags];
  // Copied item by item, not just the array: a patch is the last thing to hold
  // these objects, and nothing downstream should be able to reach back.
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
