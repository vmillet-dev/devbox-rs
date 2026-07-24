import { Injectable, computed, inject, signal } from '@angular/core';
import { Note, NoteSection } from '../models/note.model';
import { NOTES_REPOSITORY } from '../data/notes-repository.token';
import { groupNotesIntoSections } from '../utils/notes-grouping.util';

export type NoteFilter = 'all' | 'pinned' | 'untriaged';

/** État et logique métier des notes, en mémoire. Toute mutation passe par les méthodes ci-dessous. */
@Injectable({ providedIn: 'root' })
export class NotesStore {
  private readonly repository = inject(NOTES_REPOSITORY);

  private readonly notes = signal<Note[]>([]);

  readonly searchQuery = signal('');
  readonly activeFilter = signal<NoteFilter>('all');
  readonly selectedTags = signal<ReadonlySet<string>>(new Set());
  readonly selectedNoteId = signal<string | null>(null);

  readonly allTags = computed(() => {
    const tags = new Set<string>();
    for (const note of this.notes()) {
      for (const tag of note.tags) tags.add(tag);
    }
    return [...tags].sort();
  });

  readonly filteredNotes = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const filter = this.activeFilter();
    const tags = this.selectedTags();

    return this.notes().filter((note) => {
      if (filter === 'pinned' && !note.pinned) return false;
      if (filter === 'untriaged' && note.lifecycle.kind !== 'expires') return false;
      if (tags.size > 0 && !note.tags.some((tag) => tags.has(tag))) return false;
      if (query && !this.matchesQuery(note, query)) return false;
      return true;
    });
  });

  readonly sections = computed<NoteSection[]>(() => groupNotesIntoSections(this.filteredNotes()));

  readonly selectedNote = computed<Note | null>(
    () => this.notes().find((note) => note.id === this.selectedNoteId()) ?? null,
  );

  constructor() {
    this.repository.loadAll().then((notes) => this.notes.set(notes));
  }

  setSearchQuery(query: string): void {
    this.searchQuery.set(query);
  }

  setFilter(filter: NoteFilter): void {
    this.activeFilter.set(filter);
  }

  toggleTag(tag: string): void {
    this.selectedTags.update((tags) => {
      const next = new Set(tags);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  openNote(id: string): void {
    this.selectedNoteId.set(id);
  }

  closeOverlay(): void {
    this.selectedNoteId.set(null);
  }

  togglePinned(id: string): void {
    this.notes.update((notes) =>
      notes.map((note) => (note.id === id ? { ...note, pinned: !note.pinned } : note)),
    );
  }

  renameNote(id: string, title: string): void {
    this.notes.update((notes) =>
      notes.map((note) => (note.id === id ? { ...note, title, updatedAt: new Date() } : note)),
    );
  }

  createDraftNote(): void {
    const now = new Date();
    const draft: Note = {
      id: `note-${now.getTime()}`,
      title: 'Nouvelle note',
      language: 'txt',
      content: '',
      source: 'À trier',
      tags: [],
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lifecycle: { kind: 'permanent' },
    };
    this.notes.update((notes) => [draft, ...notes]);
    this.openNote(draft.id);
  }

  private matchesQuery(note: Note, query: string): boolean {
    return (
      note.title.toLowerCase().includes(query) ||
      note.tags.some((tag) => tag.toLowerCase().includes(query)) ||
      note.content.toLowerCase().includes(query)
    );
  }
}
