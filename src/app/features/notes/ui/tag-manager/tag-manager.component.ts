import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogBackdropDirective } from '@shared/a11y/dialog-backdrop.directive';
import { FocusTrapDirective } from '@shared/a11y/focus-trap.directive';
import { TagUsage } from '@features/notes/model/note.model';

/**
 * Gestion globale des tags : cocher, puis renommer, fusionner ou supprimer.
 *
 * Un seul champ de destination pour le renommage **et** la fusion : côté base
 * c'est la même opération, et deux champs feraient croire à deux mécanismes.
 * Le libellé du bouton suit le nombre de tags cochés.
 */
@Component({
  selector: 'app-tag-manager',
  imports: [DialogBackdropDirective, FocusTrapDirective, TranslocoPipe],
  templateUrl: './tag-manager.component.html',
  styleUrl: './tag-manager.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class TagManagerComponent {
  readonly tags = input.required<readonly TagUsage[]>();
  readonly selected = input.required<ReadonlySet<string>>();
  readonly isLoading = input(false);

  readonly closed = output<void>();
  readonly toggled = output<string>();
  readonly renameRequested = output<string>();
  readonly deleteRequested = output<void>();

  protected readonly target = signal('');
  protected readonly confirmingDelete = signal(false);

  protected readonly selectionCount = computed(() => this.selected().size);
  protected readonly canApply = computed(() => this.selectionCount() > 0);

  /** Un seul tag coché : c'est un renommage. Plusieurs : c'est une fusion. */
  protected readonly applyKey = computed(() =>
    this.selectionCount() > 1 ? 'tagManager.merge' : 'tagManager.rename',
  );

  protected submit(event: Event): void {
    event.preventDefault();
    const target = this.target().trim();
    if (!target || !this.canApply()) return;

    this.renameRequested.emit(target);
    this.target.set('');
  }

  protected onDeleteClick(): void {
    if (!this.canApply()) return;

    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.confirmingDelete.set(false);
    this.deleteRequested.emit();
  }
}
