import { Injectable, Signal, computed, inject, resource, signal } from '@angular/core';
import { NOTES_REPOSITORY } from '../data/notes-repository.token';
import { ErrorNotifier } from '../errors/error-notifier.service';
import { FALLBACK_LANGUAGE } from '../models/language.model';
import { NoteSection } from '../models/note-section.model';
import { Note, NoteDraft } from '../models/note.model';
import { ClockService } from '../time/clock.service';
import { groupNotesIntoSections, toSearchResultsSection } from '../utils/notes-grouping.util';

/**
 * `untriaged` = notes portant une date d'expiration. Dans le modèle du produit,
 * une note éphémère est précisément une note dont on n'a pas encore décidé du
 * sort — d'où le libellé « à trier ».
 */
export type NoteFilter = 'all' | 'pinned' | 'untriaged';

/**
 * État et logique métier des notes.
 *
 * Deux principes structurent cette classe :
 *
 * 1. **Les signaux inscriptibles restent privés**, exposés en lecture seule.
 *    Toute mutation passe donc forcément par une méthode, qui peut alors
 *    persister, gérer l'échec et rester le seul point d'entrée le jour où une
 *    écriture devient plus qu'un `set()`.
 * 2. **Les écritures sont optimistes.** L'UI se met à jour immédiatement, puis
 *    la persistance confirme (on adopte la note renvoyée, qui fait autorité) ou
 *    échoue (on restaure la note d'origine et on prévient l'utilisateur).
 */
@Injectable({ providedIn: 'root' })
export class NotesStore {
  private readonly repository = inject(NOTES_REPOSITORY);
  private readonly clock = inject(ClockService);
  private readonly notifier = inject(ErrorNotifier);

  /**
   * Chargement initial. `resource()` fournit `isLoading` / `error` / `reload()`
   * et rend la valeur inscriptible, ce qui permet d'y appliquer les mutations
   * locales sans dupliquer la liste dans un second signal.
   */
  private readonly notesResource = resource({
    loader: () => this.repository.loadAll(),
    defaultValue: [] as readonly Note[],
  });

  /**
   * `notesResource.value()` **lève** quand la ressource est en erreur ; ce
   * garde-fou est donc le seul accès autorisé à la liste.
   */
  private readonly notes = computed<readonly Note[]>(() =>
    this.notesResource.hasValue() ? this.notesResource.value() : [],
  );

  readonly isLoading = this.notesResource.isLoading;
  readonly loadError: Signal<Error | undefined> = this.notesResource.error;

  private readonly _searchQuery = signal('');
  private readonly _activeFilter = signal<NoteFilter>('all');
  private readonly _selectedTags = signal<ReadonlySet<string>>(new Set());
  private readonly _selectedNoteId = signal<string | null>(null);

  readonly searchQuery = this._searchQuery.asReadonly();
  readonly activeFilter = this._activeFilter.asReadonly();
  readonly selectedTags = this._selectedTags.asReadonly();
  readonly selectedNoteId = this._selectedNoteId.asReadonly();

  readonly allTags = computed<readonly string[]>(() => {
    const tags = new Set<string>();
    for (const note of this.notes()) {
      for (const tag of note.tags) tags.add(tag);
    }
    return [...tags].sort();
  });

  /** Une recherche ou une sélection de tags est active : l'affichage passe en liste de résultats. */
  readonly isFiltering = computed(
    () => this._searchQuery().trim().length > 0 || this._selectedTags().size > 0,
  );

  readonly filteredNotes = computed<readonly Note[]>(() => {
    const query = this._searchQuery().trim().toLowerCase();
    const filter = this._activeFilter();
    const tags = this._selectedTags();

    return this.notes().filter((note) => {
      if (filter === 'pinned' && !note.pinned) return false;
      if (filter === 'untriaged' && note.lifecycle.kind !== 'expires') return false;
      if (tags.size > 0 && !note.tags.some((tag) => tags.has(tag))) return false;
      if (query && !matchesQuery(note, query)) return false;
      return true;
    });
  });

  readonly sections = computed<readonly NoteSection[]>(() => {
    const notes = this.filteredNotes();
    return this.isFiltering()
      ? [toSearchResultsSection(notes)]
      : groupNotesIntoSections(notes, this.clock.now());
  });

  /** Recherche active mais aucun résultat : l'UI doit le dire explicitement. */
  readonly hasNoResults = computed(() => this.isFiltering() && this.filteredNotes().length === 0);

  readonly selectedNote = computed<Note | null>(
    () => this.notes().find((note) => note.id === this._selectedNoteId()) ?? null,
  );

  reload(): void {
    this.notesResource.reload();
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setFilter(filter: NoteFilter): void {
    this._activeFilter.set(filter);
  }

  toggleTag(tag: string): void {
    this._selectedTags.update((tags) => {
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
    this._selectedNoteId.set(id);
  }

  closeOverlay(): void {
    this._selectedNoteId.set(null);
  }

  async togglePinned(id: string): Promise<void> {
    const target = this.notes().find((note) => note.id === id);
    if (!target) return;

    await this.persist(target, { pinned: !target.pinned });
  }

  async renameNote(id: string, title: string): Promise<void> {
    const target = this.notes().find((note) => note.id === id);
    // Un `(input)` émet à chaque frappe : ne rien persister si le titre n'a pas bougé.
    if (!target || target.title === title) return;

    await this.persist(target, { title });
  }

  /**
   * Crée une note vide et l'ouvre. Contrairement aux autres mutations, celle-ci
   * n'est pas optimiste : l'identifiant est attribué par la persistance, et
   * afficher une note sous un identifiant provisoire obligerait à le corriger
   * après coup — y compris dans la sélection en cours.
   */
  async createNote(): Promise<void> {
    const draft: NoteDraft = {
      // Titre et source vides : l'UI affiche des libellés de remplacement
      // traduits. Stocker « Nouvelle note » en dur figerait du français
      // dans les données.
      title: '',
      language: FALLBACK_LANGUAGE,
      content: '',
      source: '',
      tags: [],
      pinned: false,
      lifecycle: { kind: 'permanent' },
    };

    try {
      const created = await this.repository.create(draft);
      this.setNotes([created, ...this.notes()]);
      this.openNote(created.id);
    } catch (error) {
      this.reportFailure('errors.noteCreateFailed', error);
    }
  }

  /**
   * Applique la modification localement, la persiste, puis adopte la note
   * renvoyée. En cas d'échec, seule la note concernée est restaurée : un
   * rollback de la liste entière écraserait les modifications concurrentes.
   */
  private async persist(target: Note, patch: Partial<Note>): Promise<void> {
    this.replaceNote({ ...target, ...patch, updatedAt: new Date() });

    try {
      const saved = await this.repository.update(target.id, patch);
      this.replaceNote(saved);
    } catch (error) {
      this.replaceNote(target);
      this.reportFailure('errors.noteSaveFailed', error);
    }
  }

  private replaceNote(note: Note): void {
    this.setNotes(this.notes().map((existing) => (existing.id === note.id ? note : existing)));
  }

  private setNotes(notes: readonly Note[]): void {
    this.notesResource.set(notes);
  }

  private reportFailure(key: string, error: unknown): void {
    console.error(error);
    this.notifier.notify({
      ref: { key },
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function matchesQuery(note: Note, query: string): boolean {
  return (
    note.title.toLowerCase().includes(query) ||
    note.tags.some((tag) => tag.toLowerCase().includes(query)) ||
    note.content.toLowerCase().includes(query)
  );
}
