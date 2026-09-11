import type { ExportReport, ImportReport } from '@core/ipc/bindings';
import { LanguageTag } from '@core/language/language.model';
import { ChecklistItem, NoteKind } from './checklist.model';

export { type ChecklistItem, type NoteKind } from './checklist.model';

export type NoteLifecycle = { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: Date };

/**
 * The back end picks the variant: "a pinned note shows its context rather than
 * its age" is a product rule. Two variants carry a date and not a label, so the
 * text can age on screen without a round trip.
 */
export type NoteFooter =
  | { readonly kind: 'source'; readonly value: string }
  | { readonly kind: 'expiry'; readonly at: Date }
  | { readonly kind: 'age'; readonly at: Date };

/**
 * Immutable: every change produces a new object (see `NotesStore`).
 *
 * `footer`, `expiringSoon`, `placeholders` and `attachmentCount` are **derived
 * by the back end and never written** — they are what `DisplayNote` adds.
 */
export interface Note {
  readonly id: string;
  /** Never empty: a note always lives in a space. */
  readonly spaceId: string;
  /** May be empty on a brand-new note; the UI then renders `notes.untitled`. */
  readonly title: string;
  readonly language: LanguageTag;
  readonly content: string;
  /** Context, e.g. "API Gateway / Auth" — its first segment is the label. */
  readonly source: string;
  readonly tags: readonly string[];
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lifecycle: NoteLifecycle;
  readonly footer: NoteFooter;
  readonly expiringSoon: boolean;
  readonly placeholders: readonly Placeholder[];
  readonly attachmentCount: number;
  readonly kind: NoteKind;
  /** Empty for a snippet. A todo list has these **instead of** `content`. */
  readonly items: readonly ChecklistItem[];
}

/**
 * The id and the timestamps are assigned by persistence; the rest is derived —
 * sending either would suggest the front decides.
 */
export type NoteDraft = Omit<
  Note,
  'id' | 'createdAt' | 'updatedAt' | 'footer' | 'expiringSoon' | 'placeholders' | 'attachmentCount'
>;

export type NotePatch = Partial<NoteDraft>;

/** `untriaged` = notes carrying a deadline, the ones whose fate is undecided. */
export type NoteFilter = 'all' | 'pinned' | 'untriaged';

/** Sent as is to `query_notes`: the front describes its intent. */
export interface NotesQuery {
  /** `null` = "all spaces", a choice and not an absence of one. */
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  /** Union semantics, like `languages`: at least one of them. Empty = all. */
  readonly tags: readonly string[];
  readonly languages: readonly LanguageTag[];
  /** Reference instant, read through `ClockService` to stay testable. */
  readonly now: Date;
  /**
   * ⚠️ `Date#getTimezoneOffset()`. The sections reason in **local** days:
   * without this offset a note created at 11 pm lands in the wrong one.
   */
  readonly tzOffsetMinutes: number;
  /**
   * Hoists pinned notes: their own section when the view is chronological, the
   * head of the list when it is flat. The canvas always says `true`; the
   * quick-paste palette follows the preference.
   */
  readonly pinnedFirst: boolean;
}

/**
 * What the canvas displays. No flat list here: it would invite re-filtering or
 * re-sorting what the back end has already done.
 */
export interface NotesView {
  readonly sections: readonly NoteSection[];
  /** Rail tags, scoped to the active space and not to the current filter. */
  readonly availableTags: readonly string[];
  readonly availableLanguages: readonly LanguageTag[];
  /** A search or a facet selection is active. */
  readonly isFiltering: boolean;
  readonly matched: number;
}

/**
 * `pinned` / `today` / `week` / `older` group chronologically; `results` is the
 * flat list of a search. Doubles as a translation key (`'sections.' + key`).
 */
export type NoteSectionKey = 'pinned' | 'today' | 'week' | 'older' | 'results';

export interface NoteSection {
  readonly key: NoteSectionKey;
  readonly notes: readonly Note[];
  readonly hasExpiringNotes: boolean;
  /** Shows the "paste or create" ghost card at the end of the section. */
  readonly showCreateGhost: boolean;
}

/**
 * A snippet's `{{name}}` field, possibly with a default (`{{port=5432}}`).
 *
 * No value map beside it: the list of fields comes from the text, the values
 * come from the database, and the back end pairs them here — a value whose
 * token has left the content is not a field, it is waiting for it back.
 */
export interface Placeholder {
  readonly name: string;
  readonly defaultValue: string;
  /** Empty until something is typed; the back end then reads `defaultValue`. */
  readonly value: string;
}

/**
 * A trashed note. Deliberately **not** a `Note`: nothing here is decorated,
 * because a discarded note is restored or purged, never opened or copied.
 *
 * `purgeAt` is derived: retention can change between versions, and a deadline
 * frozen in the database would not follow.
 */
export interface TrashedNote {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly language: LanguageTag;
  readonly content: string;
  readonly tags: readonly string[];
  readonly deletedAt: Date;
  readonly purgeAt: Date;
  /** A todo list has no `content`: the panel shows a label, not a blank preview. */
  readonly kind: NoteKind;
}

export interface TagUsage {
  readonly tag: string;
  readonly noteCount: number;
}

/**
 * An attachment record. The bytes are not here: they arrive on demand, as a
 * `data:` URI, through `AttachmentsRepository.read`.
 */
export interface Attachment {
  readonly id: string;
  readonly noteId: string;
  /** The original name, displayed as is. Never used as a path. */
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly createdAt: Date;
}

/**
 * Aliases of the **generated** types: both are plain counters and cross the
 * bridge as themselves, so re-declaring them would only be an identity mapper
 * kept for symmetry.
 */
export type { ExportReport, ImportReport };
