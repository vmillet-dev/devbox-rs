import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ClipboardService } from '@core/clipboard/clipboard.service';
import { ErrorNotifier } from '@core/errors/error-notifier.service';
import { ClockService } from '@core/time/clock.service';
import { AppWindowService } from '@core/window/app-window.service';
import { NotesRepository } from '../data/notes.repository';
import { noteCopyText } from '../model/checklist.model';
import { Note } from '../model/note.model';
import { SEARCH_DEBOUNCE_MS } from './notes.store';

/** Au-delà, la liste ne tient plus à l'écran et le clavier n'y navigue plus. */
const MAX_RESULTS = 8;

/**
 * Palette de collage rapide, ouverte par `Ctrl+Alt+P` depuis n'importe quelle
 * application.
 *
 * Elle **capture autant qu'elle retrouve** : ce qui est tapé sans correspondre à
 * un snippet peut devenir une note, ce qui en fait le chemin le plus court entre
 * une idée et une note enregistrée.
 *
 * Elle interroge **tous les espaces** et ignore les filtres du canevas : quand
 * on rappelle un snippet, on ne se souvient pas de l'espace où on l'a rangé.
 *
 * Elle ne réutilise pas `NotesStore` pour la même raison — sa recherche
 * modifierait ce que le canevas affiche derrière elle.
 */
@Injectable({ providedIn: 'root' })
export class PaletteStore {
  private readonly repository = inject(NotesRepository);
  private readonly clipboard = inject(ClipboardService);
  private readonly clock = inject(ClockService);
  private readonly window = inject(AppWindowService);
  private readonly notifier = inject(ErrorNotifier);

  private readonly _isOpen = signal(false);
  private readonly _query = signal('');
  private readonly _results = signal<readonly Note[]>([]);
  private readonly _highlighted = signal(0);
  private readonly _pendingFill = signal<Note | null>(null);

  readonly isOpen = this._isOpen.asReadonly();
  readonly query = this._query.asReadonly();
  readonly results = this._results.asReadonly();
  readonly pendingFill = this._pendingFill.asReadonly();

  /**
   * Ce qui a été tapé peut devenir une note : la palette sert autant à
   * **capturer** qu'à retrouver. La ligne de création est proposée dès qu'il y a
   * quelque chose à écrire, et elle vient **après** les résultats — retrouver un
   * snippet reste le geste le plus fréquent, et il garde la première place.
   */
  readonly canCreate = computed(() => this._query().trim().length > 0);

  /** Résultats plus, éventuellement, la ligne de création. */
  readonly optionCount = computed(() => this._results().length + (this.canCreate() ? 1 : 0));

  /** Borné : une liste qui rétrécit ne doit pas laisser l'index dehors. */
  readonly highlighted = computed(() => Math.min(this._highlighted(), Math.max(0, this.optionCount() - 1)));

  readonly isCreateHighlighted = computed(
    () => this.canCreate() && this.highlighted() === this._results().length,
  );

  readonly highlightedNote = computed<Note | null>(() => this._results()[this.highlighted()] ?? null);

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelPendingSearch());
  }

  /** Ouvre sur les notes les plus récentes : rouvrir sans taper a un sens. */
  async open(): Promise<void> {
    this._isOpen.set(true);
    this._query.set('');
    this._pendingFill.set(null);
    this._highlighted.set(0);
    await this.search('');
  }

  close(): void {
    this.cancelPendingSearch();
    this._isOpen.set(false);
    this._pendingFill.set(null);
  }

  setQuery(query: string): void {
    this._query.set(query);
    this._highlighted.set(0);
    this.cancelPendingSearch();
    this.searchTimeout = setTimeout(() => {
      this.searchTimeout = null;
      void this.search(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Butée en haut comme en bas : reboucler ferait perdre de vue où on en est. */
  moveHighlight(step: number): void {
    const last = this.optionCount() - 1;
    this._highlighted.set(Math.max(0, Math.min(last, this.highlighted() + step)));
  }

  highlight(index: number): void {
    this._highlighted.set(index);
  }

  /**
   * Contenu de la note à créer quand c'est la ligne de création qui est
   * retenue, sinon `null` — et la palette se referme au passage.
   *
   * Le store ne crée pas lui-même : il ne connaît pas `NotesStore`, et
   * l'inverse serait un cycle. C'est la page qui enchaîne, comme partout
   * ailleurs ici.
   */
  takeNewNoteContent(): string | null {
    if (!this.isCreateHighlighted()) return null;

    const content = this._query().trim();
    this.close();

    return content;
  }

  /**
   * Copie et s'efface. Un snippet à champs passe d'abord par le formulaire :
   * copier `psql -h {{host}}` tel quel donnerait une commande inutilisable.
   */
  async chooseHighlighted(): Promise<void> {
    const note = this.highlightedNote();
    if (!note) return;

    if (note.placeholders.length > 0) {
      this._pendingFill.set(note);
      return;
    }

    // Une todolist n'a pas de contenu : sans ce rendu, la palette poserait une
    // chaîne vide dans le presse-papier.
    await this.copyAndDismiss(noteCopyText(note));
  }

  /** Sortie du formulaire de champs, ou choix explicite de copier le brut. */
  async copyAndDismiss(content: string): Promise<void> {
    if (!(await this.clipboard.copy(content))) {
      this.notifier.notify({ ref: { key: 'errors.copyFailed' } });
      return;
    }

    this.close();
    // La fenêtre s'efface : l'utilisateur repart coller là où il était.
    await this.window.hide();
  }

  cancelFill(): void {
    this._pendingFill.set(null);
  }

  private async search(query: string): Promise<void> {
    const now = this.clock.now();

    try {
      const view = await this.repository.query({
        // Tous les espaces, aucun filtre : la palette cherche partout.
        spaceId: null,
        search: query.trim(),
        filter: 'all',
        tags: [],
        languages: [],
        now,
        tzOffsetMinutes: now.getTimezoneOffset(),
      });

      this._results.set(view.sections.flatMap((section) => [...section.notes]).slice(0, MAX_RESULTS));
    } catch (error) {
      this.notifier.reportFailure('errors.notesLoadFailed', error);
      this._results.set([]);
    }
  }

  private cancelPendingSearch(): void {
    if (this.searchTimeout !== null) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
  }
}
