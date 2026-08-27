import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Bandeau d'annulation d'une suppression.
 *
 * `role="status"` et non `alert` : une suppression demandée par l'utilisateur
 * n'est pas une alerte, et un lecteur d'écran ne doit pas couper la parole pour
 * l'annoncer.
 */
@Component({
  selector: 'app-undo-bar',
  imports: [TranslocoPipe],
  templateUrl: './undo-bar.component.html',
  styleUrl: './undo-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UndoBarComponent {
  readonly count = input.required<number>();

  readonly undone = output<void>();
  readonly dismissed = output<void>();
}
