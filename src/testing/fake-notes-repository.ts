import { guard } from './fail-next';
import { NotesRepository } from '@core/data/notes.repository';
import { Note, NoteDraft, NotePatch, TagUsage, TrashedNote } from '@core/model/note.model';
import { NotesQuery, NotesView } from '@core/model/note.model';
import { checklistMarkdown } from './note.fixture';

/** Mirrors `notes::trash::RETENTION`, so the double's `purgeAt` is plausible. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * In-memory `NotesRepository` double. It deliberately does **not** reimplement filtering,
 * grouping, tag normalisation or `{{field}}` parsing: those live in Rust and are tested
 * there, and duplicating them would let a front-end spec pass against rules the real back
 * end does not apply.
 *
 * What it emulates is persistence — it owns the notes, assigns ids and timestamps — plus a
 * trivial single-section view; a spec needing a specific one sets it with `setView`.
 * Deletion is a **soft** one here too, which is what makes undo observable.
 *
 * `Pick<…, keyof …>` is the public surface of the real class: `keyof` drops its private
 * members, and a method renamed or dropped there fails this file at compile time.
 */
export class FakeNotesRepository implements Pick<NotesRepository, keyof NotesRepository> {
  private notes: readonly Note[];
  private trashed: readonly TrashedNote[] = [];
  private forcedView: NotesView | null = null;
  private nextId = 0;

  /** When set, the next call to any method rejects with this error, then clears. */
  failNext: Error | null = null;

  /** Query the store sent last, for asserting how it assembles its parameters. */
  lastQuery: NotesQuery | null = null;
  queryCount = 0;

  /** Calls recorded for the operations that return only a count. */
  movedTo: { ids: readonly string[]; spaceId: string } | null = null;
  taggedWith: { ids: readonly string[]; tags: readonly string[] } | null = null;
  retagged: { tags: readonly string[]; into: string } | null = null;
  deletedTags: string[] = [];

  /** Global `{{field}}` values, the corpus-wide fallback of a note's own. */
  private variables: Record<string, string> = {};

  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;

  constructor(notes: readonly Note[] = []) {
    this.notes = notes;
  }

  /** Pins the view the backend is pretending to return, ignoring the stored notes. */
  setView(view: Partial<NotesView>): void {
    this.forcedView = { ...this.trivialView(), ...view };
  }

  /**
   * Suspends every query until `release()`: the store only reports loading before its
   * first view lands, so observing that state needs a query that stays in flight.
   */
  hold(): void {
    this.gate = new Promise<void>((resolve) => (this.openGate = resolve));
  }

  release(): void {
    this.openGate?.();
    this.gate = null;
    this.openGate = null;
  }

  async query(query: NotesQuery): Promise<NotesView> {
    await this.gate;
    return guard(this, () => {
      this.lastQuery = query;
      this.queryCount += 1;
      return this.forcedView ?? this.trivialView();
    });
  }

  create(draft: NoteDraft): Promise<Note> {
    return guard(this, () => {
      const now = new Date();
      const note: Note = {
        ...draft,
        id: `fake-${++this.nextId}`,
        createdAt: now,
        updatedAt: now,
        footer: { kind: 'age', at: now },
        expiringSoon: false,
        placeholders: [],
        attachmentCount: 0,
        copyText: draft.kind === 'checklist' ? checklistMarkdown(draft.items) : null,
      };
      this.notes = [note, ...this.notes];
      return note;
    });
  }

  update(id: string, patch: NotePatch): Promise<Note> {
    return guard(this, () => {
      const existing = this.notes.find((note) => note.id === id);
      if (!existing) {
        throw new Error(`Unknown note: ${id}`);
      }
      const updated: Note = { ...existing, ...patch, updatedAt: new Date() };
      this.notes = this.notes.map((note) => (note.id === id ? updated : note));
      return updated;
    });
  }

  delete(id: string): Promise<void> {
    return guard(this, () => {
      this.trash([id]);
    });
  }

  deleteMany(ids: readonly string[]): Promise<number> {
    return guard(this, () => this.trash(ids));
  }

  restore(ids: readonly string[]): Promise<number> {
    return guard(this, () => {
      const restored = this.trashed.filter((note) => ids.includes(note.id));
      this.trashed = this.trashed.filter((note) => !ids.includes(note.id));
      this.notes = [
        ...restored.map((note) => ({
          ...note,
          updatedAt: note.deletedAt,
          createdAt: note.deletedAt,
          pinned: false,
          source: '',
          lifecycle: { kind: 'permanent' } as const,
          footer: { kind: 'age', at: note.deletedAt } as const,
          expiringSoon: false,
          placeholders: [],
          attachmentCount: 0,
          copyText: null,
          // The trash shape drops the items; a spec needing them restored uses `setView`.
          items: [],
        })),
        ...this.notes,
      ];
      return restored.length;
    });
  }

  loadTrash(): Promise<readonly TrashedNote[]> {
    return guard(this, () => this.trashed);
  }

  purge(ids: readonly string[]): Promise<number> {
    return guard(this, () => {
      const before = this.trashed.length;
      this.trashed = this.trashed.filter((note) => !ids.includes(note.id));
      return before - this.trashed.length;
    });
  }

  emptyTrash(): Promise<number> {
    return guard(this, () => {
      const count = this.trashed.length;
      this.trashed = [];
      return count;
    });
  }

  moveMany(ids: readonly string[], spaceId: string): Promise<number> {
    return guard(this, () => {
      this.movedTo = { ids, spaceId };
      this.notes = this.notes.map((note) => (ids.includes(note.id) ? { ...note, spaceId } : note));
      return ids.length;
    });
  }

  tagMany(ids: readonly string[], tags: readonly string[]): Promise<number> {
    return guard(this, () => {
      this.taggedWith = { ids, tags };
      this.notes = this.notes.map((note) =>
        ids.includes(note.id) ? { ...note, tags: [...note.tags, ...tags] } : note,
      );
      return ids.length;
    });
  }

  loadTags(): Promise<readonly TagUsage[]> {
    return guard(this, () => {
      const counts = new Map<string, number>();
      for (const note of this.notes) {
        for (const tag of note.tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      return [...counts]
        .map(([tag, noteCount]) => ({ tag, noteCount }))
        .sort((a, b) => a.tag.localeCompare(b.tag));
    });
  }

  renameTag(tag: string, into: string): Promise<number> {
    return this.mergeTags([tag], into);
  }

  mergeTags(tags: readonly string[], into: string): Promise<number> {
    return guard(this, () => {
      this.retagged = { tags, into };
      this.notes = this.notes.map((note) => ({
        ...note,
        tags: [...new Set(note.tags.map((tag) => (tags.includes(tag) ? into : tag)))],
      }));
      return tags.length;
    });
  }

  deleteTags(tags: readonly string[]): Promise<number> {
    return guard(this, () => {
      this.deletedTags.push(...tags);
      this.notes = this.notes.map((note) => ({
        ...note,
        tags: note.tags.filter((existing) => !tags.includes(existing)),
      }));
      return tags.length;
    });
  }

  /** `updatedAt` is deliberately left alone — that is the point of the command it stands
   * for. */
  setPlaceholderValues(id: string, values: Record<string, string>): Promise<Note> {
    return guard(this, () => {
      const existing = this.notes.find((note) => note.id === id);
      if (!existing) {
        throw new Error(`Unknown note: ${id}`);
      }
      const updated: Note = {
        ...existing,
        // The fields come from the content, which only Rust parses.
        placeholders: existing.placeholders.map((placeholder) => ({
          ...placeholder,
          value: values[placeholder.name] ?? '',
        })),
      };
      this.notes = this.notes.map((note) => (note.id === id ? updated : note));
      return updated;
    });
  }

  /**
   * The real one delegates to Rust; the double substitutes naively, global variables
   * included, since they are what a typed value falls back to.
   */
  fillPlaceholders(content: string, values: Record<string, string>): Promise<string> {
    return guard(this, () =>
      Object.entries({ ...this.variables, ...values }).reduce(
        (filled, [name, value]) => filled.split(`{{${name}}}`).join(value),
        content,
      ),
    );
  }

  loadVariables(): Promise<Record<string, string>> {
    return guard(this, () => ({ ...this.variables }));
  }

  /** Empty values are dropped, exactly as `normalize_values` does in Rust. */
  saveVariables(values: Record<string, string>): Promise<Record<string, string>> {
    return guard(this, () => {
      this.variables = Object.fromEntries(
        Object.entries(values).filter(([name, value]) => name !== '' && value !== ''),
      );
      return { ...this.variables };
    });
  }

  private trash(ids: readonly string[]): number {
    const removed = this.notes.filter((note) => ids.includes(note.id));
    this.notes = this.notes.filter((note) => !ids.includes(note.id));

    const deletedAt = new Date();
    this.trashed = [
      ...removed.map((note) => ({
        id: note.id,
        spaceId: note.spaceId,
        title: note.title,
        language: note.language,
        content: note.content,
        tags: note.tags,
        kind: note.kind,
        deletedAt,
        purgeAt: new Date(deletedAt.getTime() + RETENTION_MS),
      })),
      ...this.trashed,
    ];

    return removed.length;
  }

  /** Every note in one section — the shape, not the grouping rules. */
  private trivialView(): NotesView {
    return {
      sections: [
        {
          key: 'week',
          notes: this.notes,
          hasExpiringNotes: this.notes.some((note) => note.lifecycle.kind === 'expires'),
          showCreateGhost: true,
        },
      ],
      availableTags: [...new Set(this.notes.flatMap((note) => note.tags))].sort(),
      availableLanguages: [...new Set(this.notes.map((note) => note.language))].sort(),
      isFiltering: false,
      matched: this.notes.length,
    };
  }
}
