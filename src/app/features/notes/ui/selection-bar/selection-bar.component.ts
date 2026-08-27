import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Space } from '@features/notes/model/space.model';

/**
 * Barre d'actions de la sélection multiple : déplacer, taguer, partager,
 * mettre à la corbeille.
 *
 * N'apparaît que lorsqu'il y a une sélection — une barre vide en permanence
 * mangerait de la hauteur au canevas pour ne rien proposer.
 */
@Component({
  selector: 'app-selection-bar',
  imports: [TranslocoPipe],
  templateUrl: './selection-bar.component.html',
  styleUrl: './selection-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectionBarComponent {
  readonly count = input.required<number>();
  readonly spaces = input<readonly Space[]>([]);

  readonly moveRequested = output<string>();
  readonly tagRequested = output<string>();
  /** Le libellé annonce le format : le Markdown ne doit pas être une surprise. */
  readonly copyRequested = output<void>();
  readonly deleteRequested = output<void>();
  readonly cleared = output<void>();

  protected readonly tagDraft = signal('');

  /**
   * Suppression en deux temps, comme ailleurs : la WebView bloque tout pendant
   * un `confirm()` natif, et une action de masse mérite plus qu'un clic.
   */
  protected readonly confirmingDelete = signal(false);

  protected onMove(spaceId: string): void {
    if (spaceId) {
      this.moveRequested.emit(spaceId);
    }
  }

  protected submitTag(event: Event): void {
    event.preventDefault();
    const tag = this.tagDraft().trim();
    if (!tag) return;

    this.tagRequested.emit(tag);
    this.tagDraft.set('');
  }

  protected onDeleteClick(): void {
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.confirmingDelete.set(false);
    this.deleteRequested.emit();
  }
}
