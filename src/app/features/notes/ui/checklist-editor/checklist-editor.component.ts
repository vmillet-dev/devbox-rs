import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChildren,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ChecklistItem, checklistProgress } from '@features/notes/model/checklist.model';

/** Ligne en cours de déplacement, et d'où elle est partie. */
interface Drag {
  readonly from: number;
  readonly to: number;
}

/**
 * La liste de tâches en édition : ajouter, renommer, cocher, supprimer,
 * réordonner.
 *
 * ⚠️ **Le glisser-déposer HTML5 est inopérant ici.** `dragDropEnabled` de Tauri
 * vaut `true` — c'est ce qui fait remonter les fichiers déposés sur la fenêtre à
 * `FileDropService` — et la WebView ne voit alors jamais passer `dragstart` ni
 * `drop`. Le déplacement est donc écrit en événements de pointeur. Le désactiver
 * casserait les pièces jointes ; ce n'est pas une option.
 *
 * `Alt+↑/↓` fait la même chose au clavier, et ce n'est pas un supplément : le
 * lint refuse une interaction que la souris seule peut déclencher.
 *
 * Comme le titre et le corps dans l'éditeur, la liste est un **brouillon local**
 * calé sur l'identifiant de la note et non sur son objet : chaque sauvegarde en
 * produit un nouveau, qui emporterait la saisie en cours. La coche, l'ajout, la
 * suppression et le déplacement sont validés tout de suite — ce sont des gestes
 * discrets ; seule la frappe attend le `blur`.
 */
@Component({
  selector: 'app-checklist-editor',
  imports: [TranslocoPipe],
  templateUrl: './checklist-editor.component.html',
  styleUrl: './checklist-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChecklistEditorComponent {
  readonly items = input.required<readonly ChecklistItem[]>();
  /** Ce sur quoi le brouillon se recale : l'identifiant, jamais l'objet note. */
  readonly noteId = input.required<string>();

  readonly itemsChanged = output<readonly ChecklistItem[]>();

  private readonly rows = viewChildren<ElementRef<HTMLInputElement>>('row');

  protected readonly draft = linkedSignal<string, ChecklistItem[]>({
    source: this.noteId,
    computation: () => untracked(() => this.items().map((item) => ({ ...item }))),
  });

  protected readonly progress = computed(() => checklistProgress(this.draft()));

  /** Index de la ligne en cours de déplacement, `null` au repos. */
  protected readonly dragging = signal<Drag | null>(null);

  /** Ligne à focaliser au prochain rendu, posée par l'ajout et la suppression. */
  private pendingFocus: number | null = null;

  protected toggle(index: number): void {
    this.draft.update((items) =>
      items.map((item, at) => (at === index ? { ...item, done: !item.done } : item)),
    );
    this.commit();
  }

  /** Frappe : purement locale, c'est le `blur` qui décide d'écrire. */
  protected setText(index: number, text: string): void {
    this.draft.update((items) => items.map((item, at) => (at === index ? { ...item, text } : item)));
  }

  /**
   * Insère après la ligne courante et lui donne le focus : taper une liste doit
   * pouvoir se faire sans jamais quitter le clavier.
   */
  protected insertAfter(index: number): void {
    this.draft.update((items) => [
      ...items.slice(0, index + 1),
      { text: '', done: false },
      ...items.slice(index + 1),
    ]);
    this.pendingFocus = index + 1;
    this.commit();
  }

  protected append(): void {
    this.draft.update((items) => [...items, { text: '', done: false }]);
    this.pendingFocus = this.draft().length - 1;
    this.commit();
  }

  protected remove(index: number): void {
    this.draft.update((items) => items.filter((_, at) => at !== index));
    // La ligne précédente, pas la suivante : c'est là que le curseur était.
    this.pendingFocus = Math.max(0, index - 1);
    this.commit();
  }

  /**
   * Retour arrière sur une ligne vide : supprime au lieu de ne rien faire.
   *
   * `Event` et non `KeyboardEvent` : une liaison à modificateur de touche
   * (`keydown.backspace`) est typée `Event` par le compilateur de gabarits.
   */
  protected onBackspace(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    if (input.value !== '' || this.draft().length === 0) return;

    event.preventDefault();
    this.remove(index);
  }

  protected move(from: number, to: number): void {
    const items = this.draft();
    if (to < 0 || to >= items.length || from === to) return;

    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    this.draft.set(reordered);
    this.pendingFocus = to;
    this.commit();
  }

  /**
   * Début d'un déplacement à la souris. `setPointerCapture` est ce qui garde les
   * événements sur la poignée même quand le curseur sort de la ligne — sans lui,
   * un geste un peu rapide se perd dès qu'il dépasse la hauteur d'une ligne.
   *
   * L'appel est optionnel : la capture rend le geste confortable, elle ne le
   * conditionne pas, et un environnement qui ne l'implémente pas (jsdom) ne doit
   * pas faire échouer le déplacement.
   */
  protected onPointerDown(event: PointerEvent, index: number): void {
    if (event.button !== 0) return;

    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.dragging.set({ from: index, to: index });
  }

  protected onPointerMove(event: PointerEvent): void {
    const drag = this.dragging();
    if (!drag) return;

    const to = this.rowIndexAt(event.clientY);
    if (to !== null && to !== drag.to) {
      this.dragging.set({ from: drag.from, to });
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    const drag = this.dragging();
    this.dragging.set(null);
    if (!drag) return;

    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    this.move(drag.from, drag.to);
  }

  /**
   * Position d'aperçu d'une ligne pendant un déplacement : elle suit la ligne
   * saisie, les autres se décalent d'un cran.
   */
  protected displayIndex(index: number): number {
    const drag = this.dragging();
    if (!drag) return index;

    if (index === drag.from) return drag.to;
    if (drag.from < index && index <= drag.to) return index - 1;
    if (drag.to <= index && index < drag.from) return index + 1;

    return index;
  }

  /**
   * Confirme la frappe en cours. Appelée au `blur` d'un champ, et par l'éditeur
   * avant de se fermer : Échap, le fond et le bouton de fermeture ne produisent
   * aucun `blur`, la dernière ligne tapée serait sinon perdue.
   */
  commit(): void {
    this.itemsChanged.emit(this.draft().map((item) => ({ ...item })));
    this.applyPendingFocus();
  }

  /** Ligne survolée, déduite du milieu de chaque rangée. */
  private rowIndexAt(clientY: number): number | null {
    const rows = this.rows();
    for (const [index, row] of rows.entries()) {
      const box = row.nativeElement.getBoundingClientRect();
      if (clientY < box.bottom) return index;
    }

    return rows.length > 0 ? rows.length - 1 : null;
  }

  private applyPendingFocus(): void {
    const index = this.pendingFocus;
    this.pendingFocus = null;
    if (index === null) return;

    // Après le rendu de la ligne créée ou déplacée, que le signal vient de
    // déclencher mais qui n'est pas encore dans le DOM.
    queueMicrotask(() => this.rows()[index]?.nativeElement.focus());
  }
}
