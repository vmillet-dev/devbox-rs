import type { ExportReport, ImportReport } from '@core/ipc/bindings';
import { LanguageTag } from '@notes/model/language.model';
import { ChecklistItem, NoteKind } from './checklist.model';

export { type ChecklistItem, type NoteKind } from './checklist.model';

export type NoteLifecycle = { readonly kind: 'permanent' } | { readonly kind: 'expires'; readonly at: Date };

/**
 * The back end picks the variant. Two carry a date and not a label, so the text can
 * age on screen without a round trip.
 */
export type NoteFooter =
  | { readonly kind: 'source'; readonly value: string }
  | { readonly kind: 'expiry'; readonly at: Date }
  | { readonly kind: 'age'; readonly at: Date };

/**
 * `footer`, `expiringSoon`, `placeholders`, `attachmentCount` and `copyText` are
 * **derived by the back end and never written** — they are what `DisplayNote` adds.
 */
export interface Note {
  readonly id: string;
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
  /**
   * What copying puts on the clipboard when that is not `content`: the Markdown of a
   * todo list's items. `null` for a snippet — see `noteCopyText`.
   */
  readonly copyText: string | null;
}

/** The id and the timestamps are assigned by persistence; the rest is derived. */
export type NoteDraft = Omit<
  Note,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'footer'
  | 'expiringSoon'
  | 'placeholders'
  | 'attachmentCount'
  | 'copyText'
>;

export type NotePatch = Partial<NoteDraft>;

/** `untriaged` = notes carrying a deadline, the ones whose fate is undecided. */
export type NoteFilter = 'all' | 'pinned' | 'untriaged';

export interface NotesQuery {
  /** `null` = "all spaces", a choice and not an absence of one. */
  readonly spaceId: string | null;
  readonly search: string;
  readonly filter: NoteFilter;
  /** Union semantics, like `languages`: at least one of them. Empty = all. */
  readonly tags: readonly string[];
  readonly languages: readonly LanguageTag[];
  readonly now: Date;
  /**
   * ⚠️ `Date#getTimezoneOffset()`. The sections reason in **local** days:
   * without this offset a note created at 11 pm lands in the wrong one.
   */
  readonly tzOffsetMinutes: number;
  /**
   * Hoists pinned notes: their own section when the view is chronological, the head of
   * the list when it is flat. The canvas always says `true`.
   */
  readonly pinnedFirst: boolean;
}

/**
 * No flat list: it would invite re-filtering or re-sorting what the back end has
 * already done.
 */
export interface NotesView {
  readonly sections: readonly NoteSection[];
  /** Rail tags, scoped to the active space and not to the current filter. */
  readonly availableTags: readonly string[];
  readonly availableLanguages: readonly LanguageTag[];
  readonly isFiltering: boolean;
  readonly matched: number;
}

/** Doubles as a translation key (`'sections.' + key`). */
export type NoteSectionKey = 'pinned' | 'today' | 'week' | 'older' | 'results';

export interface NoteSection {
  readonly key: NoteSectionKey;
  readonly notes: readonly Note[];
  readonly hasExpiringNotes: boolean;
  readonly showCreateGhost: boolean;
}

/**
 * No value map beside it: the list of fields comes from the text, the values from the
 * database, and the back end pairs them here — a value whose token has left the
 * content is not a field, it is waiting for it back.
 */
export interface Placeholder {
  readonly name: string;
  readonly defaultValue: string;
  /** Empty until something is typed; the back end then reads `defaultValue`. */
  readonly value: string;
}

/**
 * Deliberately **not** a `Note`: nothing here is decorated, a discarded note being
 * restored or purged, never opened. `purgeAt` is derived — retention can change
 * between versions.
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

/** The bytes are not here: they arrive on demand, as a `data:` URI. */
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
 * Plain counters that cross the bridge as themselves: re-declaring them would only be
 * an identity mapper kept for symmetry.
 */
export type { ExportReport, ImportReport };
