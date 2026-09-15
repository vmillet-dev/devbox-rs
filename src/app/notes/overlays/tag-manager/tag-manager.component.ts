import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DialogComponent } from '@shared/layout/dialog/dialog.component';
import { TagUsage } from '@core/model/note.model';

/** One field for renaming and merging: in the database it is the same operation. */
@Component({
  selector: 'app-tag-manager',
  imports: [DialogComponent, TranslocoPipe],
  templateUrl: './tag-manager.component.html',
  styleUrl: './tag-manager.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  /** One tag ticked is a rename. Several is a merge. */
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
